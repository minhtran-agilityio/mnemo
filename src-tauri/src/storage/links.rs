//! The shared link between two items of any type. A link has no direction: the pair
//! is stored once, smaller (kind name, id) first, so A-B and B-A are the same link.
//! Removing a link is a soft delete; adding it again brings the same row back.

use rusqlite::{params, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};

use super::error::StorageError;
use super::items::{exists_sql, into_page, ItemKind};
use super::record::{now_iso, Cursor, Page, PageRequest, RecordBase};
use super::Storage;

/// One item, named by its type and id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemRef {
    pub kind: ItemKind,
    pub id: String,
}

/// A live link, seen from one of its two items: `other` is the item at the far end.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub id: String,
    pub other: ItemRef,
    pub created_at: String,
}

const LINK_NOT_FOUND: StorageError = StorageError::NotFound { kind: "link" };

// Adds the pair, or brings a removed one back. A live pair keeps its updated_at.
const UPSERT_SQL: &str =
    "INSERT INTO item_link (id, a_kind, a_id, b_kind, b_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
     ON CONFLICT (a_kind, a_id, b_kind, b_id) DO UPDATE SET
         updated_at = CASE WHEN deleted_at IS NULL THEN updated_at ELSE excluded.updated_at END,
         deleted_at = NULL
     RETURNING id, created_at";

// ?1 and ?2 name the item; ?3 and ?4 are the cursor (or NULL); ?5 the row limit.
const LIST_SQL: &str = "SELECT id, created_at,
         CASE WHEN a_kind = ?1 AND a_id = ?2 THEN b_kind ELSE a_kind END,
         CASE WHEN a_kind = ?1 AND a_id = ?2 THEN b_id ELSE a_id END
     FROM item_link
     WHERE deleted_at IS NULL
       AND ((a_kind = ?1 AND a_id = ?2) OR (b_kind = ?1 AND b_id = ?2))
       AND (?3 IS NULL OR (created_at, id) < (?3, ?4))
     ORDER BY created_at DESC, id DESC LIMIT ?5";

const REMOVE_SQL: &str = "UPDATE item_link SET deleted_at = ?2, updated_at = ?2
     WHERE id = ?1 AND deleted_at IS NULL";

const HIDE_ALL_SQL: &str = "UPDATE item_link SET deleted_at = ?3, updated_at = ?3
     WHERE deleted_at IS NULL
       AND ((a_kind = ?1 AND a_id = ?2) OR (b_kind = ?1 AND b_id = ?2))";

/// Removes every live link of an item, inside the caller's transaction.
pub(crate) fn hide_links_of(
    tx: &Transaction<'_>,
    kind: ItemKind,
    id: &str,
    now: &str,
) -> Result<(), StorageError> {
    tx.execute(HIDE_ALL_SQL, params![kind, id, now])?;
    Ok(())
}

fn require_live(tx: &Transaction<'_>, item: &ItemRef) -> Result<(), StorageError> {
    let n: i64 = tx.query_row(exists_sql(item.kind), [&item.id], |r| r.get(0))?;
    if n == 0 {
        return Err(StorageError::NotFound {
            kind: item.kind.as_str(),
        });
    }
    Ok(())
}

impl Storage {
    /// Links two live items. Linking an item to itself is refused; linking a pair that
    /// is already linked returns that link.
    pub fn add_link(&mut self, a: &ItemRef, b: &ItemRef) -> Result<Link, StorageError> {
        self.add_link_at(&now_iso(), a, b)
    }

    pub(crate) fn add_link_at(
        &mut self,
        now: &str,
        a: &ItemRef,
        b: &ItemRef,
    ) -> Result<Link, StorageError> {
        if a == b {
            return Err(StorageError::Invalid(
                "An item cannot be linked to itself.".to_string(),
            ));
        }
        // Order by the stored kind name, then the id, never by the enum's order.
        let (first, second) =
            if (a.kind.as_str(), a.id.as_str()) <= (b.kind.as_str(), b.id.as_str()) {
                (a, b)
            } else {
                (b, a)
            };
        // Immediate: the checks and the write see the same state, and a second writer
        // waits for the busy timeout instead of failing at once.
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_live(&tx, a)?;
        require_live(&tx, b)?;
        let base = RecordBase::new_at(now);
        let (id, created_at): (String, String) = tx.query_row(
            UPSERT_SQL,
            params![base.id, first.kind, first.id, second.kind, second.id, now],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        tx.commit()?;
        Ok(Link {
            id,
            other: b.clone(),
            created_at,
        })
    }

    /// One page of the live links of `item`, newest first, each naming the other end.
    pub fn list_links(
        &self,
        item: &ItemRef,
        page: &PageRequest,
    ) -> Result<Page<Link>, StorageError> {
        page.validate()?;
        let (at, after_id) = match &page.after {
            Some(c) => (Some(c.created_at.as_str()), Some(c.id.as_str())),
            None => (None, None),
        };
        let mut stmt = self.conn.prepare_cached(LIST_SQL)?;
        let rows = stmt
            .query_map(
                params![item.kind, item.id, at, after_id, page.limit + 1],
                |r| {
                    Ok(Link {
                        id: r.get(0)?,
                        created_at: r.get(1)?,
                        other: ItemRef {
                            kind: r.get(2)?,
                            id: r.get(3)?,
                        },
                    })
                },
            )?
            .collect::<Result<Vec<Link>, _>>()?;
        Ok(into_page(rows, page.limit, |l: &Link| Cursor {
            created_at: l.created_at.clone(),
            id: l.id.clone(),
        }))
    }

    /// Removes a link (soft delete). A missing or already removed link gives `NotFound`.
    pub fn remove_link(&self, id: &str) -> Result<(), StorageError> {
        self.remove_link_at(&now_iso(), id)
    }

    pub(crate) fn remove_link_at(&self, now: &str, id: &str) -> Result<(), StorageError> {
        match self.conn.execute(REMOVE_SQL, [id, now])? {
            0 => Err(LINK_NOT_FOUND),
            _ => Ok(()),
        }
    }

    #[cfg(test)]
    fn link_row(&self, id: &str) -> Option<(Option<String>, String)> {
        self.conn
            .query_row(
                "SELECT deleted_at, updated_at FROM item_link WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::items::tests::{bookmark, note, T1};
    use crate::storage::items::{
        Bookmark, Idea, IdeaInput, IdeaStage, Note, Project, ProjectInput, Task, TaskInput,
    };
    use crate::storage::testing::open_temp;

    const T2: &str = "2026-01-02T00:00:00Z";
    const T3: &str = "2026-01-03T00:00:00Z";

    fn r(kind: ItemKind, id: &str) -> ItemRef {
        ItemRef {
            kind,
            id: id.to_string(),
        }
    }

    fn others(s: &Storage, item: &ItemRef) -> Vec<ItemRef> {
        s.list_links(item, &PageRequest::first(100))
            .unwrap()
            .items
            .into_iter()
            .map(|l| l.other)
            .collect()
    }

    fn bookmark_and_project(s: &mut Storage) -> (ItemRef, ItemRef) {
        let b: Bookmark = s.add_at(T1, &bookmark("https://example.com")).unwrap();
        let p: Project = s
            .add_at(
                T1,
                &ProjectInput {
                    title: "Mnemo".into(),
                    status: "active".into(),
                },
            )
            .unwrap();
        (
            r(ItemKind::Bookmark, &b.base.id),
            r(ItemKind::Project, &p.base.id),
        )
    }

    #[test]
    fn links_add_list_from_both_sides_and_remove() {
        let (mut s, _dir) = open_temp();
        let (b, p) = bookmark_and_project(&mut s);
        let link = s.add_link_at(T2, &p, &b).unwrap();
        assert_eq!(link.other, b);
        assert_eq!(link.created_at, T2);
        assert_eq!(others(&s, &b), vec![p.clone()]);
        assert_eq!(others(&s, &p), vec![b.clone()]);
        // B-A is the same link as A-B.
        assert_eq!(s.add_link_at(T3, &b, &p).unwrap().id, link.id);
        assert_eq!(
            s.link_row(&link.id).unwrap().1,
            T2,
            "a live link keeps updated_at"
        );
        s.remove_link_at(T3, &link.id).unwrap();
        assert!(others(&s, &b).is_empty());
        assert!(others(&s, &p).is_empty());
        assert_eq!(
            s.link_row(&link.id).unwrap().0.as_deref(),
            Some(T3),
            "the row stays"
        );
        assert!(matches!(
            s.remove_link_at(T3, &link.id),
            Err(StorageError::NotFound { kind: "link" })
        ));
        assert!(matches!(
            s.remove_link("missing"),
            Err(StorageError::NotFound { kind: "link" })
        ));
    }

    #[test]
    fn links_add_again_after_remove_revives_the_same_link() {
        let (mut s, _dir) = open_temp();
        let (b, p) = bookmark_and_project(&mut s);
        let first = s.add_link_at(T1, &b, &p).unwrap();
        s.remove_link_at(T2, &first.id).unwrap();
        let again = s.add_link_at(T3, &p, &b).unwrap();
        assert_eq!(again.id, first.id);
        assert_eq!(s.link_row(&first.id).unwrap(), (None, T3.to_string()));
        assert_eq!(others(&s, &b), vec![p]);
    }

    #[test]
    fn links_add_refuses_a_self_link_and_a_missing_or_deleted_end() {
        let (mut s, _dir) = open_temp();
        let (b, p) = bookmark_and_project(&mut s);
        assert!(matches!(
            s.add_link_at(T1, &b, &b),
            Err(StorageError::Invalid(_))
        ));
        assert!(matches!(
            s.add_link_at(T1, &b, &r(ItemKind::Note, "missing")),
            Err(StorageError::NotFound { kind: "note" })
        ));
        // The right id with the wrong kind is missing too.
        assert!(matches!(
            s.add_link_at(T1, &r(ItemKind::Task, &b.id), &p),
            Err(StorageError::NotFound { kind: "task" })
        ));
        s.delete_at::<Project>(T2, &p.id).unwrap();
        assert!(matches!(
            s.add_link_at(T3, &b, &p),
            Err(StorageError::NotFound { kind: "project" })
        ));
        assert!(others(&s, &b).is_empty());
    }

    #[test]
    fn links_of_a_deleted_item_are_hidden_from_both_sides() {
        let (mut s, _dir) = open_temp();
        let (b, p) = bookmark_and_project(&mut s);
        let n: Note = s.add_at(T1, &note("n")).unwrap();
        let n = r(ItemKind::Note, &n.base.id);
        let bp = s.add_link_at(T1, &b, &p).unwrap();
        s.add_link_at(T1, &n, &p).unwrap();
        s.delete_at::<Bookmark>(T2, &b.id).unwrap();
        assert_eq!(others(&s, &p), vec![n.clone()]);
        assert!(others(&s, &b).is_empty());
        assert_eq!(s.link_row(&bp.id).unwrap().0.as_deref(), Some(T2));
    }

    #[test]
    fn links_work_between_any_two_types() {
        let (mut s, _dir) = open_temp();
        let i: Idea = s
            .add_at(
                T1,
                &IdeaInput {
                    title: "i".into(),
                    stage: IdeaStage::Spark,
                },
            )
            .unwrap();
        let t: Task = s
            .add_at(
                T1,
                &TaskInput {
                    title: "t".into(),
                    done: false,
                },
            )
            .unwrap();
        let (i, t) = (r(ItemKind::Idea, &i.base.id), r(ItemKind::Task, &t.base.id));
        s.add_link(&t, &i).unwrap();
        assert_eq!(others(&s, &i), vec![t.clone()]);
        assert_eq!(others(&s, &t), vec![i]);
    }

    #[test]
    fn links_list_pages_return_every_link_once() {
        let (mut s, _dir) = open_temp();
        let hub: Note = s.add_at(T1, &note("hub")).unwrap();
        let hub = r(ItemKind::Note, &hub.base.id);
        for n in 0..12 {
            let other: Note = s.add_at(T1, &note(&format!("n{n}"))).unwrap();
            s.add_link_at(T1, &hub, &r(ItemKind::Note, &other.base.id))
                .unwrap();
        }
        let mut seen = std::collections::HashSet::new();
        let mut req = PageRequest::first(5);
        loop {
            let page = s.list_links(&hub, &req).unwrap();
            seen.extend(page.items.into_iter().map(|l| l.id));
            match page.next {
                Some(c) => req.after = Some(c),
                None => break,
            }
        }
        assert_eq!(seen.len(), 12);
        assert!(matches!(
            s.list_links(&hub, &PageRequest::first(0)),
            Err(StorageError::Invalid(_))
        ));
    }
}
