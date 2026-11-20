import { AlertTriangle, CheckCircle2, Clock, Layers, MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';
import type { BoardActionBody } from '../lib/board';
import { uid } from '../lib/board';
import { activeCards, DEFAULT_TILES, foldForPie, history, METRICS, metricLabel, slices, type Slice } from '../lib/dashboard';
import type { Filters } from '../lib/filters';
import { dayDiff, dueStatus } from '../lib/filters';
import type { BoardData, DashboardChart, DashboardMetric, DashboardTile, Person } from '../lib/types';
import { Menu, Modal } from './ui';

// ---------------------------------------------------------------- chart pictures (for the picker)

export function ChartIcon({ chart, active, size = 120 }: { chart: DashboardChart; active?: boolean; size?: number }) {
  const g = active;
  if (chart === 'bar')
    return (
      <svg viewBox="0 0 120 100" width={size} height={size * 0.83} aria-hidden>
        <defs>
          <linearGradient id="barg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f19bd9" />
            <stop offset="1" stopColor="#6d48d6" />
          </linearGradient>
        </defs>
        <rect x="22" y="40" width="20" height="36" rx="4" fill={g ? '#2c2a7a' : '#7a869a'} />
        <rect x="50" y="14" width="20" height="62" rx="4" fill={g ? 'url(#barg)' : '#c1c7d0'} />
        <rect x="78" y="32" width="20" height="44" rx="4" fill={g ? '#2c2a7a' : '#7a869a'} />
        <rect x="14" y="80" width="92" height="6" rx="3" fill={g ? '#3a2f9e' : '#7a869a'} />
        <rect x="38" y="86" width="5" height="9" rx="2" fill={g ? '#3a2f9e' : '#7a869a'} />
        <rect x="77" y="86" width="5" height="9" rx="2" fill={g ? '#3a2f9e' : '#7a869a'} />
      </svg>
    );
  if (chart === 'pie')
    return (
      <svg viewBox="0 0 120 100" width={size} height={size * 0.83} aria-hidden>
        <defs>
          <linearGradient id="pieg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3b82f6" />
            <stop offset="1" stopColor="#3730a3" />
          </linearGradient>
        </defs>
        <circle cx="54" cy="56" r="36" fill={g ? 'url(#pieg)' : '#7a869a'} />
        <path d="M62 12 a38 38 0 0 1 38 38 h-38 z" fill={g ? '#67e8f9' : '#dfe1e6'} />
      </svg>
    );
  return (
    <svg viewBox="0 0 120 100" width={size} height={size * 0.83} aria-hidden>
      <defs>
        <linearGradient id="lineg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={g ? '#a5f3fc' : '#c1c7d0'} />
          <stop offset="1" stopColor={g ? '#1e1b4b' : '#7a869a'} />
        </linearGradient>
      </defs>
      <rect x="22" y="14" width="76" height="72" rx="10" fill="url(#lineg)" />
      <path d="M10 66 L48 46 L60 60 L108 34" fill="none" stroke={g ? '#f472b6' : '#dfe1e6'} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const CHART_NAMES: Record<DashboardChart, string> = { bar: 'Bar graph', pie: 'Pie chart', line: 'Line chart' };

// ---------------------------------------------------------------- charts

function BarChart({ data, onPick }: { data: Slice[]; onPick?: (key: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = data.reduce((n, s) => n + s.value, 0);
  const max = Math.max(1, ...data.map((b) => b.value));
  if (data.length === 0) return <p className="muted">Nothing to show yet.</p>;
  return (
    <div className="bars" role="table">
      {data.map((b) => (
        <div
          key={b.key}
          className={`bar-row ${onPick ? 'clickable' : ''}`}
          role="row"
          onMouseEnter={() => setHover(b.key)}
          onMouseLeave={() => setHover(null)}
          onClick={() => onPick?.(b.key)}
        >
          <span className="bar-label" role="cell" title={b.label}>
            {b.label}
          </span>
          <span className="bar-track" role="cell">
            <span className="bar-fill" style={{ width: `${Math.max(b.value ? 2 : 0, (b.value / max) * 100)}%`, background: b.color }} />
            {hover === b.key && (
              <span className="bar-tip">
                <strong>{b.label}</strong>
                <span>
                  {b.value} card{b.value === 1 ? '' : 's'} · {total ? Math.round((b.value / total) * 100) : 0}%
                </span>
              </span>
            )}
          </span>
          <span className="bar-value" role="cell">
            {b.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function PieChart({ data, onPick }: { data: Slice[]; onPick?: (key: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const slices = foldForPie(data);
  const total = slices.reduce((n, s) => n + s.value, 0);
  if (total === 0) return <p className="muted">Nothing to show yet.</p>;
  const R = 70;
  const r = 44;
  let angle = -Math.PI / 2;
  const arc = (a0: number, a1: number) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${100 + rad * Math.cos(a)} ${100 + rad * Math.sin(a)}`;
    return `M${p(R, a0)} A${R} ${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`;
  };
  const hovered = slices.find((s) => s.key === hover);
  return (
    <div className="pie">
      <svg viewBox="0 0 200 200" className="pie-svg" role="img" aria-label="Pie chart">
        {slices.map((s) => {
          const a0 = angle;
          const a1 = angle + (s.value / total) * Math.PI * 2;
          angle = a1;
          // Single slice: draw a full ring.
          const d = slices.length === 1 ? arc(-Math.PI / 2, Math.PI * 1.5 - 0.0001) : arc(a0, a1);
          return (
            <path
              key={s.key}
              d={d}
              fill={s.color}
              stroke="#fff"
              strokeWidth={2}
              opacity={hover && hover !== s.key ? 0.45 : 1}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onPick?.(s.key)}
              style={{ cursor: onPick ? 'pointer' : 'default' }}
            />
          );
        })}
        <text x="100" y="96" textAnchor="middle" className="pie-total">
          {hovered ? hovered.value : total}
        </text>
        <text x="100" y="116" textAnchor="middle" className="pie-sub">
          {hovered ? `${Math.round((hovered.value / total) * 100)}%` : 'cards'}
        </text>
      </svg>
      <ul className="pie-legend">
        {slices.map((s) => (
          <li
            key={s.key}
            className={hover === s.key ? 'on' : ''}
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onPick?.(s.key)}
          >
            <span className="swatch-dot" style={{ background: s.color }} />
            <span className="legend-label">{s.label}</span>
            <span className="legend-value">
              {s.value} · {Math.round((s.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineChart({ days, series }: { days: number[]; series: { key: string; label: string; color: string; points: number[] }[] }) {
  const [hi, setHi] = useState<number | null>(null);
  if (series.length === 0) return <p className="muted">Nothing to show for this timeframe.</p>;
  const W = 520;
  const H = 220;
  const pad = { l: 32, r: 12, t: 12, b: 26 };
  const max = Math.max(1, ...series.flatMap((s) => s.points));
  const niceMax = Math.ceil(max / Math.max(1, Math.ceil(max / 4))) * Math.max(1, Math.ceil(max / 4));
  const x = (i: number) => pad.l + (days.length === 1 ? 0 : (i / (days.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => H - pad.b - (v / niceMax) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round((niceMax / 4) * i));
  const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const step = Math.ceil(days.length / 6);
  return (
    <div className="line-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="line-svg"
        onMouseMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * W;
          const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (days.length - 1));
          setHi(Math.max(0, Math.min(days.length - 1, i)));
        }}
        onMouseLeave={() => setHi(null)}
        role="img"
        aria-label="Line chart"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">
              {t}
            </text>
          </g>
        ))}
        {days.map((d, i) =>
          i % step === 0 || i === days.length - 1 ? (
            <text key={d} x={x(i)} y={H - 8} textAnchor="middle" className="axis">
              {fmt(d)}
            </text>
          ) : null,
        )}
        {series.map((s) => (
          <polyline key={s.key} points={s.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hi !== null && (
          <g>
            <line x1={x(hi)} x2={x(hi)} y1={pad.t} y2={H - pad.b} className="crosshair" />
            {series.map((s) => (
              <circle key={s.key} cx={x(hi)} cy={y(s.points[hi])} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hi !== null && (
        <div className="line-tip" style={{ left: `${(x(hi) / W) * 100}%` }}>
          <strong>{fmt(days[hi])}</strong>
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} /> {s.label}: {s.points[hi]}
            </span>
          ))}
        </div>
      )}
      <ul className="pie-legend inline">
        {series.map((s) => (
          <li key={s.key}>
            <span className="swatch-line" style={{ background: s.color }} />
            <span className="legend-label">{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- add-tile window (Trello flow)

function AddTileModal({ onClose, onAdd }: { onClose: () => void; onAdd: (t: DashboardTile) => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [chart, setChart] = useState<DashboardChart>('bar');
  const [metric, setMetric] = useState<DashboardMetric>('list');
  const [days, setDays] = useState<7 | 14 | 30>(7);
  const metrics = METRICS.filter((m) => chart !== 'line' || m.id !== 'status');

  return (
    <Modal onClose={onClose} bare className="tile-modal">
      {step === 1 ? (
        <div className="tile-step1">
          <div className="tile-head">
            <h3>Add tile</h3>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="tile-choices">
            {(['bar', 'pie', 'line'] as DashboardChart[]).map((c) => (
              <button key={c} className={`tile-choice ${chart === c ? 'on' : ''}`} onClick={() => setChart(c)} onDoubleClick={() => (setChart(c), setStep(2))}>
                <ChartIcon chart={c} active={chart === c} />
                <span>{CHART_NAMES[c]}</span>
              </button>
            ))}
          </div>
          <div className="tile-foot">
            <button className="btn primary" onClick={() => setStep(2)}>
              Next
            </button>
          </div>
        </div>
      ) : (
        <div className="tile-step2">
          <div className="tile-rail">
            {(['bar', 'pie', 'line'] as DashboardChart[]).map((c) => (
              <button key={c} className={`tile-rail-btn ${chart === c ? 'on' : ''}`} onClick={() => setChart(c)} aria-label={CHART_NAMES[c]} title={CHART_NAMES[c]}>
                <ChartIcon chart={c} active={chart === c} size={56} />
              </button>
            ))}
          </div>
          <div className="tile-form">
            <div className="tile-head">
              <h3>Add {CHART_NAMES[chart].toLowerCase()}</h3>
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>
            {chart === 'line' && (
              <fieldset>
                <legend>Timeframe</legend>
                {([7, 14, 30] as const).map((d) => (
                  <label key={d} className="radio-row">
                    <input type="radio" name="days" checked={days === d} onChange={() => setDays(d)} />
                    {d === 7 ? 'Past week' : d === 14 ? 'Past two weeks' : 'Past month'}
                  </label>
                ))}
              </fieldset>
            )}
            <fieldset>
              <legend>Type</legend>
              {metrics.map((m) => (
                <label key={m.id} className="radio-row">
                  <input type="radio" name="metric" checked={metric === m.id} onChange={() => setMetric(m.id)} />
                  {m.label}
                </label>
              ))}
            </fieldset>
            <div className="tile-foot">
              <button className="btn" onClick={() => setStep(1)}>
                Back
              </button>
              <button
                className="btn primary"
                onClick={() => onAdd({ id: uid(), chart, metric: chart === 'line' && metric === 'status' ? 'list' : metric, ...(chart === 'line' ? { days } : {}) })}
              >
                Add tile
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- dashboard

export function DashboardView({
  data,
  dispatch,
  editable,
  filters,
  meId,
  people,
  onFilter,
}: {
  data: BoardData;
  dispatch: (a: BoardActionBody) => void;
  editable: boolean;
  filters: Filters;
  meId: string;
  people: Map<string, Person>;
  onFilter: (patch: Partial<Filters>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const tiles = data.dashboard ?? DEFAULT_TILES;
  const save = (next: DashboardTile[]) => dispatch({ type: 'SET_DASHBOARD', tiles: next });

  const cards = activeCards(data, filters, meId);
  const total = cards.length;
  const completed = cards.filter(({ c }) => c.completed || c.dueDone).length;
  const overdue = cards.filter(({ c }) => dueStatus(c) === 'overdue').length;
  const week = cards.filter(({ c }) => c.due && !c.dueDone && dayDiff(c.due) >= 0 && dayDiff(c.due) <= 7).length;

  const pick = (metric: DashboardMetric) => (key: string) => {
    if (key === '__other' || key === '__none') return;
    if (metric === 'member' && !key.startsWith('guest:')) onFilter({ assignee: key });
    if (metric === 'label') onFilter({ labelId: key });
    if (metric === 'priority') onFilter({ priority: key as Filters['priority'] });
    if (metric === 'due') onFilter({ due: key === 'soon' || key === 'later' ? 'week' : (key as Filters['due']) });
  };

  return (
    <div className="dashboard">
      <div className="stat-row">
        <div className="stat">
          <Layers size={18} />
          <span className="stat-num">{total}</span>
          <span className="stat-label">Cards</span>
        </div>
        <div className="stat good">
          <CheckCircle2 size={18} />
          <span className="stat-num">{completed}</span>
          <span className="stat-label">Completed{total ? ` · ${Math.round((completed / total) * 100)}%` : ''}</span>
        </div>
        <button className="stat bad" onClick={() => onFilter({ due: 'overdue' })} title="Show overdue cards">
          <AlertTriangle size={18} />
          <span className="stat-num">{overdue}</span>
          <span className="stat-label">Overdue</span>
        </button>
        <button className="stat warn" onClick={() => onFilter({ due: 'week' })} title="Show cards due in the next 7 days">
          <Clock size={18} />
          <span className="stat-num">{week}</span>
          <span className="stat-label">Due in 7 days</span>
        </button>
      </div>

      <div className="dash-grid">
        {tiles.map((t) => {
          const title = `${metricLabel(t.metric)}${t.chart === 'line' ? ` · ${t.days === 30 ? 'past month' : t.days === 14 ? 'past two weeks' : 'past week'}` : ''}`;
          return (
            <section key={t.id} className="dash-card">
              <div className="dash-card-head">
                <h4>{title}</h4>
                {editable && (
                  <span className="menu-anchor">
                    <button className="icon-btn" onClick={() => setMenuFor(menuFor === t.id ? null : t.id)} aria-label="Tile options">
                      <MoreHorizontal size={16} />
                    </button>
                    <Menu open={menuFor === t.id} onClose={() => setMenuFor(null)}>
                      {(['bar', 'pie', 'line'] as DashboardChart[])
                        .filter((c) => c !== t.chart && !(c === 'line' && t.metric === 'status'))
                        .map((c) => (
                          <button
                            key={c}
                            onClick={() => {
                              setMenuFor(null);
                              save(tiles.map((x) => (x.id === t.id ? { ...x, chart: c, ...(c === 'line' ? { days: x.days ?? 7 } : {}) } : x)));
                            }}
                          >
                            Show as {CHART_NAMES[c].toLowerCase()}
                          </button>
                        ))}
                      <hr />
                      <button
                        className="danger-text"
                        onClick={() => {
                          setMenuFor(null);
                          save(tiles.filter((x) => x.id !== t.id));
                        }}
                      >
                        Remove tile
                      </button>
                    </Menu>
                  </span>
                )}
              </div>
              {t.chart === 'bar' && <BarChart data={slices(t.metric, data, filters, meId, people)} onPick={pick(t.metric)} />}
              {t.chart === 'pie' && <PieChart data={slices(t.metric, data, filters, meId, people)} onPick={pick(t.metric)} />}
              {t.chart === 'line' && <LineChart {...history(t.metric, t.days ?? 7, data, filters, meId, people)} />}
            </section>
          );
        })}
        {editable && (
          <button className="dash-add" onClick={() => setAdding(true)} aria-label="Add tile">
            <Plus size={30} />
          </button>
        )}
      </div>
      <p className="dash-note">Click a bar, slice or tile to filter. Numbers follow the active filters. Tiles are shared with everyone on this board.</p>

      {adding && (
        <AddTileModal
          onClose={() => setAdding(false)}
          onAdd={(tile) => {
            save([...tiles, tile]);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}
