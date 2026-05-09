// Left-column workspace tree (Phase 8).
//
// Flattens workspace+file tree into a Row[] then chooses non-virtual
// rendering vs @tanstack/react-virtual based on row count. The
// VIRTUAL_THRESHOLD is set low (>=30 rows) so the dependency starts
// earning its weight as soon as the daemon registry returns >a few
// workspaces.
//
// Expand state lives in two per-session dicts:
//   - openWs        : keyed by workspace name (globally unique)
//   - openFolders   : keyed by `<workspace>::<path>` (composite key
//                     so two workspaces with `src/` don't collide)

import { Fragment, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Icon } from "@/blocks/Icon";
import { useTetherStore } from "@/store";
import type { Workspace } from "@/store/types";

const VIRTUAL_THRESHOLD = 30;
const ROW_HEIGHT_PX = 24;

type Row =
  | { kind: "ws"; ws: Workspace; open: boolean }
  | {
      kind: "file";
      ws: Workspace;
      path: string;
      isFolder: boolean;
      dirty: boolean;
      open: boolean;
    };

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

const folderKey = (wsName: string, path: string): string =>
  `${wsName}::${path}`;

export function WorkspaceTree() {
  const activeWorkspace = useTetherStore((s) => s.activeWorkspace);
  const workspaces = useTetherStore((s) => s.workspaces);
  const setActiveWorkspace = useTetherStore((s) => s.setActiveWorkspace);

  const [openWs, setOpenWs] = useState<Record<string, boolean>>({
    "tether-app": true,
  });
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({
    [folderKey("tether-app", "src/")]: true,
    [folderKey("tether-app", "src/blocks/")]: true,
  });

  const rows = useMemo<Row[]>(() => {
    const acc: Row[] = [];
    for (const ws of Object.values(workspaces)) {
      const wsOpen = openWs[ws.name] ?? false;
      acc.push({ kind: "ws", ws, open: wsOpen });
      if (!wsOpen) continue;
      for (const path of ws.files) {
        const isFolder = path.endsWith("/");
        acc.push({
          kind: "file",
          ws,
          path,
          isFolder,
          dirty: ws.dirty.includes(path),
          open: openFolders[folderKey(ws.name, path)] ?? false,
        });
      }
    }
    return acc;
  }, [workspaces, openWs, openFolders]);

  const renderRow = (row: Row) => {
    if (row.kind === "ws") {
      return (
        <div
          className={
            "tree-row " + (row.ws.name === activeWorkspace ? "active" : "")
          }
          onClick={() => {
            setOpenWs((o) => ({ ...o, [row.ws.name]: !o[row.ws.name] }));
            setActiveWorkspace(row.ws.name);
          }}
          style={{ paddingLeft: 8 }}
        >
          <Icon
            name={row.open ? "chev-down" : "chevron"}
            size={11}
            style={{ color: "var(--ink-quat)", marginRight: 2 }}
          />
          <span className={"ws-dot " + row.ws.status} />
          <span className="tree-label" style={{ fontWeight: 600 }}>
            {row.ws.name}
          </span>
        </div>
      );
    }
    return (
      <TreeRow
        name={row.path}
        type={row.isFolder ? "folder" : "file"}
        depth={1}
        dirty={row.dirty}
        // No `activeFile` in the store yet — Phase-9 will add one.
        // For now, no row gets an active highlight; previously this
        // was hardcoded to `src/blocks/dag.tsx` which was a visual lie.
        active={false}
        open={row.open}
        onToggle={() =>
          setOpenFolders((o) => {
            const k = folderKey(row.ws.name, row.path);
            return { ...o, [k]: !o[k] };
          })
        }
      />
    );
  };

  if (rows.length < VIRTUAL_THRESHOLD) {
    return (
      <>
        {rows.map((row) => (
          <Fragment key={rowKey(row)}>{renderRow(row)}</Fragment>
        ))}
      </>
    );
  }

  return <VirtualizedTree rows={rows} renderRow={renderRow} />;
}

function VirtualizedTree({
  rows,
  renderRow,
}: {
  rows: Row[];
  renderRow: (row: Row) => React.ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 8,
  });

  return (
    <div
      ref={parentRef}
      className="scroll-thin"
      style={{ height: "100%", overflow: "auto" }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((vRow) => {
          const row = rows[vRow.index];
          if (!row) return null;
          return (
            <div
              key={rowKey(row)}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              {renderRow(row)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function rowKey(row: Row): string {
  return row.kind === "ws"
    ? `ws:${row.ws.name}`
    : `f:${row.ws.name}:${row.path}`;
}
