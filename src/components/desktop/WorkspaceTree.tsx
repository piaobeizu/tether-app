// Left-column workspace tree. v0.1: in-memory expand state per session,
// no persistence; the workspace list comes from the store.
//
// Phase 8 will swap the manual tree for a virtualized library
// (react-arborist or @tanstack/virtual) when N >= 50 ws becomes
// realistic — see .claude/claude-design.md plan.

import { Fragment, useState } from "react";
import { useTetherStore } from "@/store";
import { Icon } from "@/blocks/Icon";

interface TreeRowProps {
  name: string;
  type: "folder" | "file" | "ws";
  depth: number;
  active?: boolean;
  dirty?: boolean;
  onClick?: () => void;
  open?: boolean;
  onToggle?: () => void;
}

function TreeRow({
  name,
  type,
  depth,
  active,
  dirty,
  onClick,
  open,
  onToggle,
}: TreeRowProps) {
  const isContainer = type === "folder" || type === "ws";
  return (
    <div
      onClick={() => {
        if (isContainer) {
          onToggle?.();
        } else {
          onClick?.();
        }
      }}
      className={"tree-row " + (active ? "active" : "")}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {isContainer ? (
        <Icon
          name={open ? "chev-down" : "chevron"}
          size={11}
          style={{ color: "var(--ink-quat)", marginRight: 2 }}
        />
      ) : (
        <span style={{ width: 13 }} />
      )}
      {type === "folder" && (
        <Icon
          name={open ? "folder-open" : "folder"}
          size={13}
          style={{ color: "var(--ink-tertiary)" }}
        />
      )}
      {type === "file" && <span className="mono file-glyph">·</span>}
      <span className="tree-label">{name}</span>
      {dirty && <span className="dirty-dot" />}
    </div>
  );
}

export function WorkspaceTree() {
  const activeWorkspace = useTetherStore((s) => s.activeWorkspace);
  const workspaces = useTetherStore((s) => s.workspaces);
  const setActiveWorkspace = useTetherStore((s) => s.setActiveWorkspace);

  const [openWs, setOpenWs] = useState<Record<string, boolean>>({
    "tether-app": true,
  });
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({
    "src/": true,
    "src/blocks/": true,
  });

  return (
    <>
      {Object.values(workspaces).map((ws) => {
        const open = openWs[ws.name];
        return (
          <Fragment key={ws.name}>
            <div
              className={
                "tree-row " + (ws.name === activeWorkspace ? "active" : "")
              }
              onClick={() => {
                setOpenWs((o) => ({ ...o, [ws.name]: !o[ws.name] }));
                setActiveWorkspace(ws.name);
              }}
              style={{ paddingLeft: 8 }}
            >
              <Icon
                name={open ? "chev-down" : "chevron"}
                size={11}
                style={{ color: "var(--ink-quat)", marginRight: 2 }}
              />
              <span className={"ws-dot " + ws.status} />
              <span className="tree-label" style={{ fontWeight: 600 }}>
                {ws.name}
              </span>
            </div>
            {open &&
              ws.files.map((f) => {
                const isFolder = f.endsWith("/");
                const dirty = ws.dirty.includes(f);
                return (
                  <TreeRow
                    key={f}
                    name={f}
                    type={isFolder ? "folder" : "file"}
                    depth={1}
                    dirty={dirty}
                    active={
                      f === "src/blocks/dag.tsx" &&
                      ws.name === activeWorkspace
                    }
                    open={openFolders[f]}
                    onToggle={() =>
                      setOpenFolders((o) => ({ ...o, [f]: !o[f] }))
                    }
                  />
                );
              })}
          </Fragment>
        );
      })}
    </>
  );
}
