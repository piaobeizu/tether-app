// Desktop three-column layout (§11.Y / D-19).
//
// Title bar (traffic + tabs + connection pill + paired pill + bolt + settings)
// optional error banner (when connection != live + banner not dismissed)
// │── workspaces ──│── skill artifact ──│── chat ──│
// status bar (connection · branch · DAG progress · version)
//
// Composer at the bottom of the chat column with slash-popover,
// ⌘↵ submit, Esc clear.

import { type KeyboardEvent, useEffect, useRef } from "react";
import {
  CandidatesCompact,
  DagCompact,
  DagFull,
  FormCompact,
  MediaCompact,
} from "@/blocks";
import { Icon } from "@/blocks/Icon";
import { SLASH_COMMANDS, useTetherStore } from "@/store";
import { Msg } from "./Msg";
import { WorkspaceTree } from "./WorkspaceTree";

export function Desktop() {
  const connection = useTetherStore((s) => s.connection);
  const paired = useTetherStore((s) => s.paired);
  const slashOpen = useTetherStore((s) => s.slashOpen);
  const composerText = useTetherStore((s) => s.composerText);
  const chat = useTetherStore((s) => s.chat);
  const errorBannerVisible = useTetherStore((s) => s.errorBannerVisible);
  const dag = useTetherStore((s) => s.dag);
  const workspaces = useTetherStore((s) => s.workspaces);
  const sendMessage = useTetherStore((s) => s.sendMessage);
  const setComposer = useTetherStore((s) => s.setComposer);
  const pickSlash = useTetherStore((s) => s.pickSlash);
  const toggleChatBlock = useTetherStore((s) => s.toggleChatBlock);
  const pauseDag = useTetherStore((s) => s.pauseDag);
  const rollbackDag = useTetherStore((s) => s.rollbackDag);
  const triggerError = useTetherStore((s) => s.triggerError);
  const reconnect = useTetherStore((s) => s.reconnect);
  const dismissBanner = useTetherStore((s) => s.dismissBanner);

  const inputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom on new messages.
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [chat.length]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
      e.preventDefault();
      sendMessage(composerText);
    } else if (e.key === "Escape") {
      setComposer("");
    }
  };

  const filteredSlash = SLASH_COMMANDS.filter((c) =>
    c.cmd.startsWith(composerText.split(" ")[0] ?? ""),
  );

  const liveCount = Object.values(workspaces).filter(
    (w) => w.status === "live",
  ).length;
  const doneNodes = dag.nodes.filter((n) => n.status === "done").length;

  return (
    <div className="dt-root">
      <div className="dt-titlebar">
        <div className="dt-traffic">
          <span style={{ background: "#E27A6F" }} />
          <span style={{ background: "#E5C36A" }} />
          <span style={{ background: "#7DB87E" }} />
        </div>
        <div className="dt-tabs">
          <span className="dt-tab on">
            <Icon
              name="tether"
              size={12}
              style={{ color: "var(--accent)" }}
            />
            tether-app · refactor
          </span>
          <span className="dt-tab">
            <Icon
              name="folder"
              size={11}
              style={{ color: "var(--ink-tertiary)" }}
            />
            tether-doc
          </span>
        </div>
        <div className="dt-titlebar-right">
          <span
            className={
              "pill " + (connection.state === "live" ? "live" : "warn")
            }
          >
            <span className="dot" />
            {connection.state === "live"
              ? `daemon · live · ${connection.latency}ms`
              : connection.state === "reconnecting"
                ? `reconnecting · attempt ${connection.attempt}`
                : "dropped"}
          </span>
          {paired && (
            <span className="pill">
              <Icon
                name="phone"
                size={10}
                style={{ color: "var(--success)" }}
              />
              Pixel · paired
            </span>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={triggerError}
            title="simulate error"
          >
            <Icon name="bolt" size={14} />
          </button>
          <button type="button" className="icon-btn">
            <Icon name="settings" size={14} />
          </button>
        </div>
      </div>

      {errorBannerVisible && connection.state !== "live" && (
        <div className="dt-error-banner">
          <span className="pulse-dot" />
          <span style={{ fontWeight: 600 }}>daemon unreachable</span>
          <span style={{ color: "var(--ink-secondary)" }}>retrying…</span>
          <button
            type="button"
            className="btn-ghost-sm"
            style={{ marginLeft: "auto" }}
            onClick={reconnect}
          >
            retry now
          </button>
          <button
            type="button"
            className="icon-btn-sm"
            onClick={dismissBanner}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      )}

      <div className="dt-grid">
        <aside className="dt-left">
          <div className="dt-left-head">
            <span className="mono section-label">WORKSPACES</span>
            <button type="button" className="icon-btn-sm">
              <Icon name="plus" size={12} />
            </button>
          </div>
          <div className="dt-search">
            <Icon
              name="search"
              size={12}
              style={{ color: "var(--ink-quat)" }}
            />
            <input placeholder="filter…" />
            <span className="kbd">⌘P</span>
          </div>
          <div className="dt-tree scroll-thin">
            <WorkspaceTree />
          </div>
          <div className="dt-left-foot">
            <span
              className="mono"
              style={{ fontSize: 10.5, color: "var(--ink-tertiary)" }}
            >
              {Object.keys(workspaces).length} workspaces · {liveCount} live
            </span>
          </div>
        </aside>

        <main className="dt-mid">
          <div className="dt-mid-head">
            <div className="dt-breadcrumb">
              <span className="mono crumb-faint">tether-app</span>
              <span className="mono crumb-sep">/</span>
              <span className="mono crumb-faint">skills</span>
              <span className="mono crumb-sep">/</span>
              <span className="mono crumb">refactor</span>
              <span className="pill warn" style={{ marginLeft: 12 }}>
                <span className="dot" />
                running
              </span>
            </div>
            <div className="dt-mid-actions">
              <button
                type="button"
                className="btn-ghost-sm"
                onClick={pauseDag}
              >
                {dag.paused ? "▶ resume" : "❚❚ pause"}
              </button>
              <button
                type="button"
                className="btn-ghost-sm"
                onClick={rollbackDag}
              >
                ↺ rollback
              </button>
              <button
                type="button"
                className="btn-primary-sm"
                onClick={() => sendMessage("approve refactor")}
              >
                approve
              </button>
            </div>
          </div>

          <div className="dt-mid-body scroll-thin">
            <div className="skill-title-block">
              <div className="serif skill-title">
                extracting fenced block renderer
              </div>
              <div className="skill-sub">
                refactoring <span className="mono">src/blocks/</span> to share
                rendering between desktop and mobile.
              </div>
            </div>
            <DagFull />
          </div>
        </main>

        <aside className="dt-right">
          <div className="dt-right-head">
            <span className="mono section-label">CHAT</span>
            <span className="pill" style={{ marginLeft: "auto" }}>
              session · 2h 14m
            </span>
          </div>

          <div className="dt-chat scroll-thin" ref={chatRef}>
            {chat.map((m) => (
              <Msg key={m.id} from={m.from} time={m.t}>
                <p style={{ margin: m.block ? "0 0 10px" : 0 }}>{m.text}</p>
                {m.block === "candidates" && (
                  <CandidatesCompact
                    onExpand={() => toggleChatBlock("candidates")}
                  />
                )}
                {m.block === "form" && (
                  <FormCompact onExpand={() => toggleChatBlock("form")} />
                )}
                {m.block === "dag" && (
                  <DagCompact onExpand={() => toggleChatBlock("dag")} />
                )}
                {m.block === "media" && (
                  <MediaCompact
                    onExpand={() => toggleChatBlock("media")}
                  />
                )}
              </Msg>
            ))}
          </div>

          <div className="dt-composer">
            {slashOpen && filteredSlash.length > 0 && (
              <div className="slash-pop">
                <div className="slash-head">
                  <span className="mono">/ commands</span>
                  <span className="kbd">esc</span>
                </div>
                {filteredSlash.map((c, i) => (
                  <div
                    key={c.cmd}
                    className={"slash-row " + (i === 0 ? "on" : "")}
                    onClick={() => pickSlash(c.cmd)}
                  >
                    <span className="mono accent">{c.cmd}</span>
                    <span className="slash-desc">{c.desc}</span>
                    <span className="kbd">↵</span>
                  </div>
                ))}
              </div>
            )}
            <div className="composer-box">
              <div className="composer-row">
                <span className="composer-prefix mono">/</span>
                <input
                  ref={inputRef}
                  value={composerText}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={onKey}
                  placeholder="message tether…"
                  className="composer-input mono"
                />
                <button
                  type="button"
                  className="send-btn"
                  onClick={() => sendMessage(composerText)}
                >
                  <Icon name="arrow-up" size={14} />
                </button>
              </div>
              <div className="composer-foot">
                <span
                  className="mono"
                  style={{ fontSize: 10.5, color: "var(--ink-tertiary)" }}
                >
                  ⌘↵ send · ⇧↵ newline
                </span>
                <span
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    color: "var(--ink-tertiary)",
                    marginLeft: "auto",
                  }}
                >
                  tether-app
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div className="dt-statusbar">
        <span className="sb-cell">
          <span
            className={"dot " + (connection.state === "live" ? "live" : "")}
          />
          {connection.state}
        </span>
        <span className="sb-cell mono">main</span>
        <span className="sb-cell mono">
          {doneNodes}/{dag.nodes.length} nodes
        </span>
        <span style={{ flex: 1 }} />
        <span className="sb-cell mono">v0.1.0-rc.3</span>
      </div>
    </div>
  );
}
