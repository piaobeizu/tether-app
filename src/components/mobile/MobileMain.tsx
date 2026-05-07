// Mobile chat-first surface (§11.Y / D-19).
// Three layers stacked inside the phone screen:
//   - Main chat view (always rendered)
//   - Workspace drawer (overlay, slides from left when drawerOpen)
//   - Skill detail push (full-screen, slides from right when
//     mobileRoute === "skill")
//
// Composer uses local React state (mirrors prototype) so typing in
// the mobile composer doesn't ghost into the desktop composer when
// both are rendered side-by-side on the canvas.

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  CandidatesCompact,
  DagCompact,
  DagFull,
  FormCompact,
  MediaCompact,
} from "@/blocks";
import { Icon } from "@/blocks/Icon";
import { useTetherStore } from "@/store";
import type { ChatRole } from "@/store/types";
export function MobileMain() {
  const chat = useTetherStore((s) => s.chat);
  const drawerOpen = useTetherStore((s) => s.drawerOpen);
  const mobileRoute = useTetherStore((s) => s.mobileRoute);
  const workspaces = useTetherStore((s) => s.workspaces);
  const activeWorkspace = useTetherStore((s) => s.activeWorkspace);
  const connection = useTetherStore((s) => s.connection);
  const dag = useTetherStore((s) => s.dag);
  const sendMessage = useTetherStore((s) => s.sendMessage);
  const toggleDrawer = useTetherStore((s) => s.toggleDrawer);
  const setActiveWorkspace = useTetherStore((s) => s.setActiveWorkspace);
  const setMobileRoute = useTetherStore((s) => s.setMobileRoute);
  const pauseDag = useTetherStore((s) => s.pauseDag);
  const rollbackDag = useTetherStore((s) => s.rollbackDag);

  const [composer, setComposer] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [chat.length]);

  const send = () => {
    if (!composer.trim()) return;
    sendMessage(composer);
    setComposer("");
  };

  const onComposerKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="m-main">
        {/* Drawer overlay — workspace list pushes from the left. */}
        {drawerOpen && (
          <div
            className="m-drawer-overlay"
            onClick={toggleDrawer}
          >
            <div
              className="m-drawer-panel"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="m-head">
                <button
                  type="button"
                  className="m-iconbtn"
                  onClick={toggleDrawer}
                >
                  <Icon name="x" size={18} />
                </button>
                <div className="m-head-mid">
                  <div className="m-head-title">workspaces</div>
                  <div className="m-head-sub mono">
                    {Object.keys(workspaces).length} total
                  </div>
                </div>
                <button type="button" className="m-iconbtn">
                  <Icon name="plus" size={16} />
                </button>
              </header>
              <div
                style={{
                  padding: "8px 8px 16px",
                  overflow: "auto",
                  flex: 1,
                }}
              >
                {Object.values(workspaces).map((ws) => (
                  <div
                    key={ws.name}
                    className={
                      "ws-row " + (ws.name === activeWorkspace ? "on" : "")
                    }
                    onClick={() => setActiveWorkspace(ws.name)}
                  >
                    <span className={"ws-row-dot " + ws.status} />
                    <div className="ws-row-mid">
                      <div className="ws-row-name">{ws.name}</div>
                      <div className="ws-row-sub mono">
                        {ws.skills} skills
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Skill detail push route. */}
        {mobileRoute === "skill" && (
          <div className="m-skill-push scroll-thin">
            <header
              className="m-head"
              style={{
                position: "sticky",
                top: 0,
                zIndex: 2,
                background: "var(--bg-app)",
              }}
            >
              <button
                type="button"
                className="m-iconbtn"
                onClick={() => setMobileRoute("main")}
              >
                <Icon name="back" size={18} />
              </button>
              <div className="m-head-mid">
                <div className="m-head-title">refactor</div>
                <div className="m-head-sub mono">
                  <span className="dot live" />
                  running
                </div>
              </div>
              <button type="button" className="m-iconbtn">
                <Icon name="ellipsis" size={16} />
              </button>
            </header>
            <div style={{ padding: "16px 14px 24px" }}>
              <div
                className="serif"
                style={{ fontStyle: "italic", fontSize: 24, lineHeight: 1.15 }}
              >
                extracting fenced
                <br />
                block renderer
              </div>
              <div style={{ marginTop: 16 }}>
                <DagFull />
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 18 }}>
                <button
                  type="button"
                  className="m-btn-ghost"
                  onClick={pauseDag}
                >
                  {dag.paused ? "▶" : "❚❚"} pause
                </button>
                <button
                  type="button"
                  className="m-btn-ghost"
                  onClick={rollbackDag}
                >
                  ↺ rollback
                </button>
                <button
                  type="button"
                  className="m-btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => {
                    sendMessage("approve");
                    setMobileRoute("main");
                  }}
                >
                  approve →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Always-rendered chat-first main view (under any push/drawer). */}
        <header className="m-head">
          <button
            type="button"
            className="m-iconbtn"
            onClick={toggleDrawer}
          >
            <Icon name="menu" size={18} />
          </button>
          <div className="m-head-mid">
            <div className="m-head-title">{activeWorkspace}</div>
            <div className="m-head-sub mono">
              <span
                className={
                  "dot " + (connection.state === "live" ? "live" : "")
                }
              />
              {connection.state === "live"
                ? "live · refactor running"
                : connection.state}
            </div>
          </div>
          <button
            type="button"
            className="m-iconbtn"
            onClick={() => setMobileRoute("skill")}
          >
            <Icon name="bolt" size={16} />
          </button>
        </header>

        <div className="m-chat scroll-thin" ref={chatRef}>
          {chat.map((m) => (
            <MobileMsg key={m.id} from={m.from} time={m.t}>
              <p
                style={{
                  margin: m.block ? "0 0 8px" : 0,
                  fontSize: 13.5,
                }}
              >
                {m.text}
              </p>
              {m.block === "candidates" && (
                <CandidatesCompact
                  onExpand={() => setMobileRoute("skill")}
                />
              )}
              {m.block === "form" && (
                <FormCompact onExpand={() => setMobileRoute("skill")} />
              )}
              {m.block === "dag" && (
                <DagCompact onExpand={() => setMobileRoute("skill")} />
              )}
              {m.block === "media" && (
                <MediaCompact onExpand={() => setMobileRoute("skill")} />
              )}
            </MobileMsg>
          ))}
        </div>

        <div className="m-composer">
          <div className="m-composer-row">
            <button type="button" className="m-iconbtn">
              <Icon name="plus" size={16} />
            </button>
            <input
              className="m-input"
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={onComposerKey}
              placeholder="message tether…"
            />
            <button type="button" className="m-send" onClick={send}>
              <Icon name="arrow-up" size={16} />
            </button>
          </div>
        </div>
    </div>
  );
}

interface MobileMsgProps {
  from: ChatRole;
  time: string;
  children: ReactNode;
}

function MobileMsg({ from, time, children }: MobileMsgProps) {
  if (from === "system") {
    return (
      <div
        style={{
          fontSize: 11.5,
          color: "var(--ink-tertiary)",
          fontStyle: "italic",
          padding: "3px 0",
        }}
      >
        <span className="mono" style={{ marginRight: 6 }}>
          {time}
        </span>
        {children}
      </div>
    );
  }
  if (from === "user") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 3,
        }}
      >
        <div
          style={{
            maxWidth: "82%",
            padding: "10px 14px",
            background: "var(--ink-primary)",
            color: "var(--bg-app)",
            borderRadius: "16px 16px 4px 16px",
            fontSize: 13.5,
            lineHeight: 1.5,
          }}
        >
          {children}
        </div>
        <span
          className="mono"
          style={{ fontSize: 10, color: "var(--ink-tertiary)" }}
        >
          {time}
        </span>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            background: "var(--accent)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
          }}
        >
          <Icon name="tether" size={11} />
        </span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>tether</span>
        <span
          className="mono"
          style={{ fontSize: 10.5, color: "var(--ink-tertiary)" }}
        >
          {time}
        </span>
      </div>
      <div style={{ paddingLeft: 25, fontSize: 13.5, lineHeight: 1.55 }}>
        {children}
      </div>
    </div>
  );
}
