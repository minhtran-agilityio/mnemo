#!/usr/bin/python3
# Test helper: a fake org.kde.StatusNotifierWatcher on the session bus.
# Usage: sni-watcher.py <file>. Appends one line "<sender>\t<registered string>" per item registered.
import sys
import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

OUT = sys.argv[1]
XML = """
<node>
  <interface name="org.kde.StatusNotifierWatcher">
    <method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method>
    <method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method>
    <property name="RegisteredStatusNotifierItems" type="as" access="read"/>
    <property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
    <property name="ProtocolVersion" type="i" access="read"/>
    <signal name="StatusNotifierItemRegistered"><arg type="s"/></signal>
    <signal name="StatusNotifierHostRegistered"/>
  </interface>
</node>
"""
items = []


def on_call(conn, sender, path, iface, method, params, inv):
    if method == "RegisterStatusNotifierItem":
        arg = params.unpack()[0]
        items.append(arg)
        with open(OUT, "a") as f:
            f.write(f"{sender}\t{arg}\n")
        conn.emit_signal(None, "/StatusNotifierWatcher", iface, "StatusNotifierItemRegistered", GLib.Variant("(s)", (arg,)))
    inv.return_value(None)


def on_get(conn, sender, path, iface, prop):
    if prop == "RegisteredStatusNotifierItems":
        return GLib.Variant("as", items)
    if prop == "IsStatusNotifierHostRegistered":
        return GLib.Variant("b", True)
    return GLib.Variant("i", 0)


def on_bus(conn, name):
    node = Gio.DBusNodeInfo.new_for_xml(XML)
    conn.register_object("/StatusNotifierWatcher", node.interfaces[0], on_call, on_get, None)


Gio.bus_own_name(Gio.BusType.SESSION, "org.kde.StatusNotifierWatcher", Gio.BusNameOwnerFlags.NONE, on_bus, None, None)
GLib.MainLoop().run()
