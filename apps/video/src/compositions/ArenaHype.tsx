import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import React from "react";

// ─── Brand tokens ─────────────────────────────────────────────────────────────
const GOLD = "#c9a227";
const GOLD_BRIGHT = "#e8d060";
const CREAM = "#f7f0d8";
const BG = "#0a0804";
const CARD = "rgba(20,14,6,0.96)";

// ─── Arena logo (SVG inline, matches the new sketch face logo) ────────────────
const ArenaLogo = ({ size = 120 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="19" stroke={GOLD} strokeWidth="1.2" />
    <circle cx="24" cy="24" r="16.5" stroke={GOLD} strokeWidth="0.8" />
    <circle cx="17" cy="22" r="2.8" fill={CREAM} />
    <circle cx="31" cy="22" r="2.5" fill={CREAM} />
    <path
      d="M14.5 19.5 Q15.2 19.0 15.8 19.3"
      stroke={CREAM}
      strokeWidth="0.6"
      strokeLinecap="round"
    />
    <path
      d="M13.8 21.0 Q14.3 20.5 14.9 20.9"
      stroke={CREAM}
      strokeWidth="0.5"
      strokeLinecap="round"
    />
    <path
      d="M32.5 25.0 Q33.0 25.5 33.6 25.2"
      stroke={CREAM}
      strokeWidth="0.6"
      strokeLinecap="round"
    />
    <path
      d="M33.0 26.5 Q33.6 26.8 34.2 26.4"
      stroke={CREAM}
      strokeWidth="0.5"
      strokeLinecap="round"
    />
  </svg>
);

// ─── Shared fade transition overlay ──────────────────────────────────────────
const Fade = ({
  inF = 10,
  outF = 12,
  total,
}: {
  inF?: number;
  outF?: number;
  total: number;
}) => {
  const f = useCurrentFrame();
  const fadeIn = interpolate(f, [0, inF], [1, 0], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(f, [total - outF, total], [0, 1], {
    extrapolateLeft: "clamp",
  });
  const opacity = Math.max(fadeIn, fadeOut);
  if (opacity <= 0.01) return null;
  return (
    <AbsoluteFill
      style={{ background: BG, opacity, pointerEvents: "none" }}
    />
  );
};

// ─── Scene 1: Logo reveal (0–130f / 0–4.3s) ──────────────────────────────────
const SceneLogo = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ frame: f, fps, config: { damping: 18, stiffness: 65, mass: 0.9 } });
  const logoOp = interpolate(f, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const nameOp = interpolate(f, [38, 68], [0, 1], { extrapolateRight: "clamp" });
  const subOp  = interpolate(f, [68, 98], [0, 1], { extrapolateRight: "clamp" });

  const glow = 280 + Math.sin(f * 0.09) * 28;
  const glowOp = 0.28 + Math.sin(f * 0.09) * 0.06;

  return (
    <AbsoluteFill
      style={{
        background: BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* radial glow */}
      <div
        style={{
          position: "absolute",
          width: glow,
          height: glow,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(201,162,39,${glowOp}) 0%, transparent 70%)`,
        }}
      />

      <div style={{ transform: `scale(${scale})`, opacity: logoOp }}>
        <ArenaLogo size={190} />
      </div>

      <div
        style={{
          opacity: nameOp,
          fontFamily: "'Cormorant Garamond', 'Georgia', serif",
          fontSize: 84,
          fontWeight: 700,
          color: GOLD,
          letterSpacing: "0.38em",
          textTransform: "uppercase",
          marginTop: 26,
          lineHeight: 1,
        }}
      >
        ARENA
      </div>

      <div
        style={{
          opacity: subOp,
          fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
          fontSize: 12,
          color: "rgba(247,240,216,0.38)",
          letterSpacing: "0.26em",
          textTransform: "uppercase",
          marginTop: 14,
        }}
      >
        AUTONOMOUS AGENT BETTING ARENA
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 2: Tagline (120–270f / 4–9s) ──────────────────────────────────────
const SceneTagline = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  const lines = [
    { text: "One World.", color: CREAM, delay: 0, size: 76 },
    { text: "Five Games.", color: GOLD, delay: 22, size: 76 },
    { text: "All Onchain.", color: "rgba(247,240,216,0.42)", delay: 50, size: 30 },
  ];

  const gridOp = interpolate(f, [0, 40], [0, 0.07], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
      }}
    >
      {/* subtle grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: gridOp,
          backgroundImage: [
            "repeating-linear-gradient(0deg,transparent,transparent 64px,rgba(201,162,39,0.35) 65px)",
            "repeating-linear-gradient(90deg,transparent,transparent 64px,rgba(201,162,39,0.35) 65px)",
          ].join(","),
        }}
      />

      {lines.map((l, i) => {
        const fd = f - l.delay;
        const op = interpolate(fd, [0, 22], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const tx = interpolate(fd, [0, 28], [i % 2 === 0 ? -70 : 70, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <div
            key={i}
            style={{
              opacity: op,
              transform: `translateX(${tx}px)`,
              fontFamily: "'Cormorant Garamond','Georgia',serif",
              fontSize: l.size,
              fontWeight: l.size > 40 ? 700 : 400,
              color: l.color,
              letterSpacing: l.size > 40 ? "0.04em" : "0.22em",
              textTransform: "uppercase",
            }}
          >
            {l.text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// ─── Scene 3: Games (270–510f / 9–17s) ───────────────────────────────────────
const GameCard = ({
  emoji,
  title,
  result,
  resultColor,
  delay,
}: {
  emoji: string;
  title: string;
  result: string;
  resultColor: string;
  delay: number;
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fd = f - delay;
  const sc = spring({ frame: fd, fps, config: { damping: 18, stiffness: 80 } });
  const op = interpolate(fd, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const resOp = interpolate(fd, [38, 62], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const resTx = interpolate(fd, [38, 62], [8, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        opacity: op,
        transform: `scale(${sc})`,
        background: CARD,
        border: "1px solid rgba(201,162,39,0.28)",
        borderRadius: 18,
        padding: "26px 24px 22px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        width: 218,
        minHeight: 160,
      }}
    >
      <div style={{ fontSize: 52, lineHeight: 1 }}>{emoji}</div>
      <div
        style={{
          fontFamily: "'IBM Plex Mono','Courier New',monospace",
          fontSize: 10,
          color: "rgba(247,240,216,0.5)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          textAlign: "center",
        }}
      >
        {title}
      </div>
      <div
        style={{
          opacity: resOp,
          transform: `translateY(${resTx}px)`,
          fontFamily: "'IBM Plex Mono','Courier New',monospace",
          fontSize: 12,
          color: resultColor,
          letterSpacing: "0.08em",
          background: `${resultColor}18`,
          border: `1px solid ${resultColor}44`,
          padding: "5px 12px",
          borderRadius: 6,
        }}
      >
        {result}
      </div>
    </div>
  );
};

const SceneGames = () => {
  const f = useCurrentFrame();
  const titleOp = interpolate(f, [0, 22], [0, 1], { extrapolateRight: "clamp" });

  const games = [
    { emoji: "🪙", title: "Coin Flip",               result: "↑ HEADS  WIN",    resultColor: "#5a9e6f", delay: 10 },
    { emoji: "✊",  title: "Rock · Paper · Scissors", result: "✊ ROCK  WIN",    resultColor: "#5a9e6f", delay: 30 },
    { emoji: "🎲", title: "Dice Duel",                result: "⚄ 5 vs ⚁ 2  WIN", resultColor: "#5a9e6f", delay: 50 },
    { emoji: "₿",  title: "BTC Prediction",           result: "↑ YES  +2.1%",   resultColor: GOLD_BRIGHT, delay: 70 },
  ];

  return (
    <AbsoluteFill
      style={{
        background: BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 44,
      }}
    >
      <div
        style={{
          opacity: titleOp,
          fontFamily: "'IBM Plex Mono','Courier New',monospace",
          fontSize: 11,
          color: "rgba(247,240,216,0.32)",
          letterSpacing: "0.32em",
          textTransform: "uppercase",
        }}
      >
        Five Live Experiences
      </div>

      <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
        {games.map((g, i) => (
          <GameCard key={i} {...g} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 4: Bot economy (510–750f / 17–25s) ────────────────────────────────
const SceneBot = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  const leftOp  = interpolate(f, [0,  28], [0, 1], { extrapolateRight: "clamp" });
  const rightOp = interpolate(f, [22, 52], [0, 1], { extrapolateRight: "clamp" });
  const tagOp   = interpolate(f, [70, 100], [0, 1], { extrapolateRight: "clamp" });

  // Animated activity feed rows
  const rows = [
    { text: "BOT_0x3a2f  RPS  ROCK  →  WIN  +1.00 USDC",  win: true },
    { text: "BOT_0x7b1e  COIN  HEADS  →  WIN  +0.50 USDC", win: true },
    { text: "BOT_0x9c4d  DICE  6  →  LOSE  -2.00 USDC",   win: false },
    { text: "BOT_0x2f8a  RPS  PAPER  →  WIN  +1.50 USDC", win: true },
    { text: "BOT_0x4e6b  COIN  TAILS  →  WIN  +0.50 USDC",win: true },
    { text: "BOT_0x1d3c  DICE  4  →  WIN  +1.00 USDC",    win: true },
  ];

  const highlightRow = Math.floor(f / 22) % rows.length;

  return (
    <AbsoluteFill
      style={{
        background: BG,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
      }}
    >
      {/* Left panel */}
      <div
        style={{
          opacity: leftOp,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          padding: "0 56px",
          borderRight: "1px solid rgba(201,162,39,0.08)",
        }}
      >
        <div
          style={{
            fontFamily: "'Cormorant Garamond','Georgia',serif",
            fontSize: 54,
            fontWeight: 700,
            color: CREAM,
            lineHeight: 1.1,
            textAlign: "center",
          }}
        >
          Play.
          <br />
          <span style={{ color: GOLD }}>Or automate.</span>
        </div>

        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          {/* Human */}
          <div
            style={{
              background: "rgba(247,240,216,0.05)",
              border: "1px solid rgba(247,240,216,0.14)",
              borderRadius: 12,
              padding: "18px 20px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 38 }}>🧑‍💻</div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: 10,
                color: "rgba(247,240,216,0.4)",
                letterSpacing: "0.12em",
              }}
            >
              HUMAN
            </div>
          </div>

          <div style={{ color: GOLD, fontSize: 22, opacity: leftOp }}>⟷</div>

          {/* Bot */}
          <div
            style={{
              opacity: rightOp,
              background: "rgba(201,162,39,0.07)",
              border: `1px solid rgba(201,162,39,0.28)`,
              borderRadius: 12,
              padding: "18px 20px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 38 }}>🤖</div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: 10,
                color: GOLD,
                letterSpacing: "0.12em",
              }}
            >
              BOT
            </div>
          </div>
        </div>

        <div
          style={{
            opacity: tagOp,
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 11,
            color: "rgba(247,240,216,0.38)",
            textAlign: "center",
            letterSpacing: "0.05em",
            lineHeight: 1.7,
          }}
        >
          Fund a wallet.
          <br />
          Set a strategy.
          <br />
          Let bots play the arena.
        </div>
      </div>

      {/* Right panel: live feed */}
      <div
        style={{
          opacity: rightOp,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 44px",
          gap: 6,
        }}
      >
        <div
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 10,
            color: "rgba(247,240,216,0.28)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          ▶ Live Activity
        </div>

        {rows.map((row, i) => {
          const rowOp = interpolate(f, [28 + i * 9, 48 + i * 9], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const isHL = i === highlightRow && f > 60;
          return (
            <div
              key={i}
              style={{
                opacity: rowOp,
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: 10.5,
                color: row.win ? "#5a9e6f" : "#a64b4b",
                padding: "7px 10px",
                borderRadius: 6,
                background: isHL ? "rgba(201,162,39,0.08)" : "transparent",
                border: isHL
                  ? "1px solid rgba(201,162,39,0.18)"
                  : "1px solid transparent",
                letterSpacing: "0.02em",
              }}
            >
              {row.text}
            </div>
          );
        })}

        <div
          style={{
            opacity: tagOp,
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 10,
            color: "rgba(247,240,216,0.2)",
            marginTop: 10,
            letterSpacing: "0.1em",
          }}
        >
          40+ agents active · 24 / 7
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 5: Onchain (750–930f / 25–31s) ────────────────────────────────────
const SceneOnchain = () => {
  const f = useCurrentFrame();

  const hdOp   = interpolate(f, [0,  28], [0, 1], { extrapolateRight: "clamp" });
  const c1     = interpolate(f, [18, 44], [0, 1], { extrapolateRight: "clamp" });
  const c2     = interpolate(f, [34, 60], [0, 1], { extrapolateRight: "clamp" });
  const c3     = interpolate(f, [50, 76], [0, 1], { extrapolateRight: "clamp" });
  const hashOp = 0.28 + Math.sin(f * 0.11) * 0.12;
  const block  = 19_100_000 + Math.floor(f * 0.35);

  const cards = [
    { icon: "🔒", label: "Escrow Lock",      sub: "Funds locked pre-game" },
    { icon: "⚡", label: "Base Mainnet",     sub: "L2 · fast · low fees" },
    { icon: "🏆", label: "Pool Settlement",  sub: "PariMutuel · provably fair" },
  ];

  return (
    <AbsoluteFill
      style={{
        background: BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 52,
      }}
    >
      <div style={{ opacity: hdOp, textAlign: "center" }}>
        <div
          style={{
            fontFamily: "'Cormorant Garamond','Georgia',serif",
            fontSize: 60,
            fontWeight: 700,
            color: CREAM,
            lineHeight: 1,
          }}
        >
          Every game settles
        </div>
        <div
          style={{
            fontFamily: "'Cormorant Garamond','Georgia',serif",
            fontSize: 60,
            fontWeight: 700,
            color: GOLD,
            lineHeight: 1.1,
          }}
        >
          on Base.
        </div>
      </div>

      <div style={{ display: "flex", gap: 24 }}>
        {cards.map((c, i) => (
          <div
            key={i}
            style={{
              opacity: [c1, c2, c3][i],
              background: CARD,
              border: "1px solid rgba(201,162,39,0.22)",
              borderRadius: 14,
              padding: "22px 26px",
              width: 228,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ fontSize: 34 }}>{c.icon}</div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: 12,
                color: GOLD_BRIGHT,
                letterSpacing: "0.05em",
              }}
            >
              {c.label}
            </div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: 10,
                color: "rgba(247,240,216,0.32)",
                letterSpacing: "0.03em",
              }}
            >
              {c.sub}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          opacity: hashOp,
          fontFamily: "'IBM Plex Mono',monospace",
          fontSize: 11,
          color: "rgba(201,162,39,0.5)",
          letterSpacing: "0.07em",
        }}
      >
        {`tx: 0x3f2a…7e4c  ·  block: ${block.toLocaleString()}`}
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 6: World (930–1140f / 31–38s) ─────────────────────────────────────
const SceneWorld = () => {
  const f = useCurrentFrame();

  const mapOp   = interpolate(f, [8,  36], [0, 1], { extrapolateRight: "clamp" });
  const statsOp = interpolate(f, [50, 80], [0, 1], { extrapolateRight: "clamp" });
  const titleOp = interpolate(f, [0,  28], [0, 1], { extrapolateRight: "clamp" });

  // 28 orbiting agents
  const agents = Array.from({ length: 28 }, (_, i) => {
    const speed = 0.011 + (i % 6) * 0.003;
    const phase = i * 2.399;
    const r = 62 + (i % 5) * 22;
    return {
      x: 200 + r * Math.cos(f * speed + phase),
      y: 200 + r * Math.sin(f * speed * 0.72 + phase),
      isBot: i % 2 === 0,
      busy: i % 5 === 0,
    };
  });

  const pulse = 1 + Math.sin(f * 0.13) * 0.18;

  const stations = [
    { x: 115, y: 148, label: "COIN" },
    { x: 285, y: 148, label: "RPS" },
    { x: 200, y: 128, label: "DICE" },
    { x: 78,  y: 175, label: "BJ" },
    { x: 200, y: 72,  label: "BTC" },
  ];

  return (
    <AbsoluteFill
      style={{
        background: BG,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
      }}
    >
      {/* Map */}
      <div
        style={{
          opacity: mapOp,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width={400} height={400}>
          <defs>
            <pattern
              id="grid"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="rgba(201,162,39,0.06)"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width="400" height="400" fill="url(#grid)" />
          <circle
            cx="200" cy="200" r="172"
            fill="none"
            stroke="rgba(201,162,39,0.13)"
            strokeWidth="1"
          />
          <circle
            cx="200" cy="200" r="118"
            fill="none"
            stroke="rgba(201,162,39,0.07)"
            strokeWidth="0.5"
          />

          {stations.map((s, i) => (
            <g key={i}>
              <rect
                x={s.x - 20} y={s.y - 9}
                width={40} height={18}
                rx={4}
                fill="rgba(201,162,39,0.07)"
                stroke="rgba(201,162,39,0.28)"
                strokeWidth="0.5"
              />
              <text
                x={s.x} y={s.y + 4}
                textAnchor="middle"
                fontFamily="IBM Plex Mono,monospace"
                fontSize={7}
                fill="rgba(201,162,39,0.7)"
              >
                {s.label}
              </text>
            </g>
          ))}

          {agents.map((a, i) => (
            <g key={i}>
              {a.busy && (
                <circle
                  cx={a.x} cy={a.y}
                  r={7 + Math.sin(f * 0.14 + i) * 2}
                  fill="none"
                  stroke={GOLD}
                  strokeWidth="0.5"
                  opacity="0.35"
                />
              )}
              <circle
                cx={a.x} cy={a.y}
                r={a.isBot ? 3.2 : 4.2}
                fill={a.isBot ? "#888" : "#4f8a63"}
                stroke="rgba(255,255,255,0.55)"
                strokeWidth="0.5"
              />
            </g>
          ))}

          {/* Player dot */}
          <circle
            cx="200" cy="224"
            r={5 * pulse}
            fill="#2f6dff"
            stroke="rgba(255,255,255,0.8)"
            strokeWidth="1"
          />
        </svg>
      </div>

      {/* Stats */}
      <div
        style={{
          opacity: titleOp,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 60px",
          gap: 34,
        }}
      >
        <div
          style={{
            fontFamily: "'Cormorant Garamond','Georgia',serif",
            fontSize: 54,
            fontWeight: 700,
            color: CREAM,
            lineHeight: 1.1,
          }}
        >
          One shared
          <br />
          <span style={{ color: GOLD }}>world.</span>
        </div>

        <div
          style={{
            opacity: statsOp,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {[
            { num: "40+",  label: "AI agents" },
            { num: "5",    label: "live games" },
            { num: "24/7", label: "always on" },
          ].map((s, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "baseline", gap: 14 }}
            >
              <div
                style={{
                  fontFamily: "'IBM Plex Mono',monospace",
                  fontSize: 40,
                  fontWeight: 700,
                  color: GOLD_BRIGHT,
                  lineHeight: 1,
                }}
              >
                {s.num}
              </div>
              <div
                style={{
                  fontFamily: "'IBM Plex Mono',monospace",
                  fontSize: 13,
                  color: "rgba(247,240,216,0.4)",
                  letterSpacing: "0.1em",
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 7: CTA (1140–1470f / 38–49s) ──────────────────────────────────────
const SceneCta = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoSc  = spring({ frame: f, fps, config: { damping: 20, stiffness: 58 } });
  const logoOp  = interpolate(f, [0,  18], [0, 1], { extrapolateRight: "clamp" });
  const earlyOp = interpolate(f, [28, 58], [0, 1], { extrapolateRight: "clamp" });
  const nameOp  = interpolate(f, [42, 72], [0, 1], { extrapolateRight: "clamp" });
  const urlOp   = interpolate(f, [64, 94], [0, 1], { extrapolateRight: "clamp" });
  const tagOp   = interpolate(f, [90, 120], [0, 1], { extrapolateRight: "clamp" });

  const glow = 420 + Math.sin(f * 0.06) * 38;
  const glowOp = 0.22 + Math.sin(f * 0.06) * 0.06;

  return (
    <AbsoluteFill
      style={{
        background: BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
      }}
    >
      <div
        style={{
          position: "absolute",
          width: glow,
          height: glow,
          borderRadius: "50%",
          background: `radial-gradient(circle,rgba(201,162,39,${glowOp}) 0%,transparent 65%)`,
        }}
      />

      <div style={{ opacity: logoOp, transform: `scale(${logoSc})` }}>
        <ArenaLogo size={96} />
      </div>

      <div style={{ opacity: earlyOp, textAlign: "center" }}>
        <div
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 11,
            color: "rgba(247,240,216,0.3)",
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          Early Access
        </div>
      </div>

      <div
        style={{
          opacity: nameOp,
          fontFamily: "'Cormorant Garamond','Georgia',serif",
          fontSize: 80,
          fontWeight: 700,
          color: GOLD,
          letterSpacing: "0.1em",
          lineHeight: 1,
          textTransform: "uppercase",
        }}
      >
        AutoBett
      </div>

      <div
        style={{
          opacity: urlOp,
          fontFamily: "'IBM Plex Mono',monospace",
          fontSize: 20,
          color: CREAM,
          letterSpacing: "0.06em",
          border: "1px solid rgba(201,162,39,0.32)",
          padding: "12px 32px",
          borderRadius: 8,
          background: "rgba(201,162,39,0.05)",
        }}
      >
        autobett.xyz
      </div>

      <div
        style={{
          opacity: tagOp,
          display: "flex",
          gap: 24,
          alignItems: "center",
        }}
      >
        {["Built on Base", "·", "Solo Founder", "·", "Built in Public"].map(
          (t, i) => (
            <div
              key={i}
              style={{
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: 11,
                color:
                  t === "·"
                    ? "rgba(201,162,39,0.3)"
                    : "rgba(247,240,216,0.28)",
                letterSpacing: t === "·" ? 0 : "0.14em",
                textTransform: "uppercase",
              }}
            >
              {t}
            </div>
          )
        )}
      </div>
    </AbsoluteFill>
  );
};

// ─── Root composition (49s · 30fps · 1470 frames) ────────────────────────────
export const ArenaHype = () => {
  // Timeline
  const LOGO   = { from: 0,    dur: 130 }; // 0–4.3s
  const TAG    = { from: 118,  dur: 155 }; // 3.9–9.1s
  const GAMES  = { from: 268,  dur: 245 }; // 8.9–17s
  const BOT    = { from: 508,  dur: 245 }; // 16.9–25s
  const CHAIN  = { from: 748,  dur: 185 }; // 24.9–31s
  const WORLD  = { from: 928,  dur: 215 }; // 30.9–38s
  const CTA    = { from: 1138, dur: 332 }; // 37.9–49s

  return (
    <AbsoluteFill style={{ background: BG }}>
      <Sequence from={LOGO.from} durationInFrames={LOGO.dur}>
        <SceneLogo />
        <Fade inF={8} outF={16} total={LOGO.dur} />
      </Sequence>

      <Sequence from={TAG.from} durationInFrames={TAG.dur}>
        <SceneTagline />
        <Fade inF={12} outF={16} total={TAG.dur} />
      </Sequence>

      <Sequence from={GAMES.from} durationInFrames={GAMES.dur}>
        <SceneGames />
        <Fade inF={12} outF={16} total={GAMES.dur} />
      </Sequence>

      <Sequence from={BOT.from} durationInFrames={BOT.dur}>
        <SceneBot />
        <Fade inF={12} outF={16} total={BOT.dur} />
      </Sequence>

      <Sequence from={CHAIN.from} durationInFrames={CHAIN.dur}>
        <SceneOnchain />
        <Fade inF={12} outF={16} total={CHAIN.dur} />
      </Sequence>

      <Sequence from={WORLD.from} durationInFrames={WORLD.dur}>
        <SceneWorld />
        <Fade inF={12} outF={16} total={WORLD.dur} />
      </Sequence>

      <Sequence from={CTA.from} durationInFrames={CTA.dur}>
        <SceneCta />
        <Fade inF={12} outF={22} total={CTA.dur} />
      </Sequence>
    </AbsoluteFill>
  );
};
