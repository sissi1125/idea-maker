/**
 * EvalTrendChart — feat-300.6 任务 9
 *
 * 自建 SVG 折线图，展示 avgOverall 趋势。
 *
 * 设计取舍（plan §3.9）：
 *   - 数据点 < 50：手撸 SVG 30 行，零依赖
 *   - 引 chart.js / recharts / echarts 都 100KB+，本期就 1 个图
 *   - 引图表库的临界点：交互复杂（hover/zoom/legend）或图表种类 ≥ 3 种
 *
 * 数据稳定性约定：
 *   - 入参 points 按时间正序（旧 → 新），调用方负责
 *   - point.avg 为 null 表示该次跑挂了（无评分），渲染时跳过连线
 *
 * a11y：
 *   - <svg role="img" aria-label="..."> + 数据点 <title> 元素 → 屏幕阅读器可读
 *   - 颜色不单一依赖（配 ↑↓ 文字）便于色盲
 */

"use client";

interface Point {
  /** ISO 时间或日期字符串 */
  date: string;
  /** avgOverall，0~5 或 null（失败 run） */
  avg: number | null;
  /** 标识，悬浮显示 */
  label?: string;
}

interface EvalTrendChartProps {
  points: Point[];
  /** 阈值线（默认 4，可视化"合格分") */
  threshold?: number;
  /** 高度（px），宽度自适应容器 */
  height?: number;
}

export function EvalTrendChart({ points, threshold = 4, height = 160 }: EvalTrendChartProps) {
  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center border border-dashed rounded text-sm text-gray-400"
        style={{ height }}
      >
        暂无评估记录 — 运行 <code className="px-1 bg-gray-100 rounded">pnpm eval</code> 后会出现趋势
      </div>
    );
  }

  // ── 坐标计算 ─────────────────────────────────────────────────────
  // 用 viewBox 让 SVG 自适应宽度；内部坐标固定 600×200，CSS 控制实际显示尺寸
  const W = 600;
  const H = 200;
  const PAD_L = 30;   // 左 padding 给 y 轴 label
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 24;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const Y_MAX = 5;
  const Y_MIN = 1;
  const xStep = points.length > 1 ? innerW / (points.length - 1) : 0;

  const yFor = (v: number) =>
    PAD_T + innerH - ((v - Y_MIN) / (Y_MAX - Y_MIN)) * innerH;
  const xFor = (i: number) => PAD_L + xStep * i;

  // 连线：跳过 null 点（断开线段）
  const segments: { d: string; key: string }[] = [];
  let currentPath: string[] = [];
  let segIdx = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.avg === null) {
      if (currentPath.length > 0) {
        segments.push({ d: currentPath.join(" "), key: `seg-${segIdx++}` });
        currentPath = [];
      }
      continue;
    }
    const x = xFor(i);
    const y = yFor(p.avg);
    currentPath.push(currentPath.length === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
  }
  if (currentPath.length > 0) segments.push({ d: currentPath.join(" "), key: `seg-${segIdx++}` });

  // 比较最后两个有效点，决定头部 delta 配色
  const validAvgs = points.filter((p) => p.avg !== null) as { avg: number; date: string }[];
  const latest = validAvgs[validAvgs.length - 1];
  const prev = validAvgs[validAvgs.length - 2];
  const delta = latest && prev ? latest.avg - prev.avg : null;

  return (
    <div className="space-y-2">
      {/* 顶部 delta 摘要 */}
      <div className="flex items-baseline gap-3 text-sm">
        <span className="text-gray-500">avg.overall</span>
        <span className="text-2xl font-semibold tabular-nums">
          {latest ? latest.avg.toFixed(2) : "—"}
        </span>
        {delta !== null && (
          <span
            className={`text-xs font-medium ${
              delta > 0.1
                ? "text-emerald-700"
                : delta < -0.1
                  ? "text-red-700"
                  : "text-gray-500"
            }`}
          >
            {delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} {Math.abs(delta).toFixed(2)}
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full block"
        style={{ height }}
        role="img"
        aria-label={`avgOverall 趋势图，共 ${points.length} 次 eval`}
      >
        {/* y 轴网格线 1/2/3/4/5 */}
        {[1, 2, 3, 4, 5].map((v) => (
          <g key={v}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="#e5e7eb"
              strokeWidth={1}
              strokeDasharray={v === threshold ? "3 3" : undefined}
            />
            <text
              x={PAD_L - 6}
              y={yFor(v) + 3}
              textAnchor="end"
              fontSize={9}
              fill={v === threshold ? "#10b981" : "#9ca3af"}
            >
              {v}
            </text>
          </g>
        ))}

        {/* 折线 */}
        {segments.map((s) => (
          <path
            key={s.key}
            d={s.d}
            fill="none"
            stroke="#059669"
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* 数据点 */}
        {points.map((p, i) => {
          if (p.avg === null) {
            // 失败点用空心红色 × 标识
            const x = xFor(i);
            const y = PAD_T + innerH; // 贴底
            return (
              <g key={`null-${i}`}>
                <text x={x} y={y - 4} fontSize={11} textAnchor="middle" fill="#dc2626">
                  ×
                </text>
                <title>{p.label ?? p.date}：失败</title>
              </g>
            );
          }
          return (
            <g key={`pt-${i}`}>
              <circle cx={xFor(i)} cy={yFor(p.avg)} r={3.5} fill="#059669" />
              <title>
                {p.label ?? p.date}：{p.avg.toFixed(2)}
              </title>
            </g>
          );
        })}

        {/* x 轴时间刻度（首 / 中 / 尾） */}
        {points.length > 0 && (
          <>
            <text x={PAD_L} y={H - 6} fontSize={9} fill="#9ca3af">
              {shortDate(points[0].date)}
            </text>
            {points.length > 2 && (
              <text
                x={PAD_L + innerW / 2}
                y={H - 6}
                fontSize={9}
                fill="#9ca3af"
                textAnchor="middle"
              >
                {shortDate(points[Math.floor(points.length / 2)].date)}
              </text>
            )}
            {points.length > 1 && (
              <text
                x={W - PAD_R}
                y={H - 6}
                fontSize={9}
                fill="#9ca3af"
                textAnchor="end"
              >
                {shortDate(points[points.length - 1].date)}
              </text>
            )}
          </>
        )}
      </svg>
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
