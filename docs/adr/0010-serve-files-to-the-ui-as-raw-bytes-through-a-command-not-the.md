---
ticket: 16
stage: intent
status: accepted
confidence: high
decided_by: claude (ship workflow: intent)
date: 2026-11-20
---

# 0010. Serve files to the UI as raw bytes through a command, not the asset protocol

## Context

The ticket asks for a safe Tauri command so the UI can show an image from the files folder. The backend rules keep the capability file minimal and forbid fs plugins for the UI.

## Options

- read_file command returns raw bytes (tauri::ipc::Response) and the UI builds a Blob object URL
- Enable Tauri asset protocol with a scope on the files folder and use convertFileSrc
- Return base64 in JSON

## Decision

read_file command returns raw bytes; the UI makes a Blob URL.

## Why

Keeps all file access inside storage behind one validated command and adds no capability scope; raw bytes avoid base64 size overhead.

## Consequences

Each image display is one IPC call carrying the whole file (up to the 20 MB limit); later UI screens (P3) use the client wrapper to get a Blob URL.

## How to reverse

Enable asset protocol scope later and switch the wrapper to convertFileSrc; the storage API does not change.
