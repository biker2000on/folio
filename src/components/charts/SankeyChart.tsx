'use client';

import { useRef, useState, useEffect, useMemo } from 'react';
import {
  sankey,
  sankeyLinkHorizontal,
  sankeyJustify,
  SankeyGraph,
  SankeyNode as D3SankeyNode,
  SankeyLink as D3SankeyLink,
} from 'd3-sankey';

/**
 * What a node is, which decides its colour. Colour here is a role, not a
 * category: money coming in, money kept, money spent, and the total they pass
 * through. A dozen hues for a dozen categories said nothing the labels did not.
 */
export type SankeyNodeKind = 'income' | 'total' | 'expense' | 'savings';

interface SankeyNode {
  name: string;
  kind?: SankeyNodeKind;
}

interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

interface SankeyChartProps {
  nodes: SankeyNode[];
  links: SankeyLink[];
  width?: number;
  height?: number;
  /** The figure shares are quoted against (total income). */
  total?: number;
  /** Accessible summary of what the diagram shows. */
  ariaLabel?: string;
}

type LaidOutNode = D3SankeyNode<SankeyNode, SankeyLink>;
type LaidOutLink = D3SankeyLink<SankeyNode, SankeyLink>;

const KIND_COLOR: Record<SankeyNodeKind, string> = {
  income: 'var(--positive)',
  savings: 'var(--primary)',
  total: 'var(--foreground-secondary)',
  expense: 'var(--foreground-muted)',
};

const NODE_WIDTH = 10;
const NODE_PADDING = 18;
/** Below this width the amounts leave the labels; names alone must fit. */
const COMPACT_WIDTH = 560;
const MARGIN = { top: 12, right: 8, bottom: 12, left: 8 };

function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function share(value: number, total: number | undefined): string | null {
  if (!total || total <= 0) return null;
  const percent = Math.round((value / total) * 100);
  return value > 0 && percent < 1 ? '<1%' : `${percent}%`;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
  value: number;
}

export default function SankeyChart({
  nodes,
  links,
  width: propWidth,
  height: propHeight,
  total,
  ariaLabel,
}: SankeyChartProps) {
  const defaultHeight = Math.max(propHeight ?? 600, 240);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: propWidth || 800, height: defaultHeight });
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [activeNode, setActiveNode] = useState<number | null>(null);
  const [activeLink, setActiveLink] = useState<number | null>(null);

  // Measure container dimensions using ResizeObserver
  useEffect(() => {
    if (!containerRef.current || propWidth) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({
          width,
          height: propHeight === undefined ? Math.max(height, 300) : propHeight,
        });
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [propWidth, propHeight]);

  const sankeyData = useMemo(() => {
    const generator = sankey<SankeyNode, SankeyLink>()
      .nodeWidth(NODE_WIDTH)
      .nodePadding(NODE_PADDING)
      .extent([
        [MARGIN.left, MARGIN.top],
        [Math.max(dimensions.width - MARGIN.right, MARGIN.left + 1), dimensions.height - MARGIN.bottom],
      ])
      .nodeAlign(sankeyJustify)
      // Largest first in every column, with what was kept at the foot of its
      // column: the ranking is the reading order.
      .nodeSort((a, b) => {
        if (a.kind === 'savings') return 1;
        if (b.kind === 'savings') return -1;
        return (b.value ?? 0) - (a.value ?? 0);
      });

    const graph: SankeyGraph<SankeyNode, SankeyLink> = {
      nodes: nodes.map((d) => ({ ...d })),
      links: links.map((d) => ({ ...d })),
    };

    return generator(graph);
  }, [nodes, links, dimensions]);

  const linkPath = sankeyLinkHorizontal();
  const compact = dimensions.width < COMPACT_WIDTH;
  const centerX = sankeyData.nodes.find(node => node.kind === 'total')?.x0 ?? dimensions.width / 2;

  const nodeColor = (node: LaidOutNode) => KIND_COLOR[node.kind ?? 'expense'];
  // A band takes the colour of whichever end is not the total, so the income
  // side reads as one colour and what was kept stands apart from what was spent.
  const linkColor = (link: LaidOutLink) => {
    const source = link.source as LaidOutNode;
    const target = link.target as LaidOutNode;
    return nodeColor(source.kind === 'total' ? target : source);
  };

  const linkIsActive = (link: LaidOutLink, index: number) => {
    if (activeLink !== null) return activeLink === index;
    if (activeNode === null) return false;
    return (link.source as LaidOutNode).index === activeNode || (link.target as LaidOutNode).index === activeNode;
  };
  const somethingActive = activeLink !== null || activeNode !== null;

  const showTooltip = (event: React.MouseEvent, title: string, value: number) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    setTooltip({
      x: event.clientX - (bounds?.left ?? 0),
      y: event.clientY - (bounds?.top ?? 0),
      title,
      value,
    });
  };

  const clear = () => {
    setTooltip(null);
    setActiveNode(null);
    setActiveLink(null);
  };

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: propHeight === undefined ? '100%' : undefined }}
    >
      <svg width={dimensions.width} height={dimensions.height} role="img" aria-label={ariaLabel ?? 'Flow diagram'}>
        <g>
          {sankeyData.links.map((link, i) => (
            <path
              key={i}
              d={linkPath(link) || ''}
              fill="none"
              stroke={linkColor(link)}
              strokeWidth={Math.max(1, link.width || 0)}
              opacity={linkIsActive(link, i) ? 0.5 : somethingActive ? 0.1 : 0.22}
              style={{ transition: 'opacity 150ms ease-out' }}
              onMouseEnter={(event) => {
                setActiveLink(i);
                showTooltip(
                  event,
                  `${(link.source as LaidOutNode).name} to ${(link.target as LaidOutNode).name}`,
                  link.value,
                );
              }}
              onMouseMove={(event) => showTooltip(
                event,
                `${(link.source as LaidOutNode).name} to ${(link.target as LaidOutNode).name}`,
                link.value,
              )}
              onMouseLeave={clear}
            />
          ))}
        </g>

        <g>
          {sankeyData.nodes.map((node, i) => {
            const x0 = node.x0 ?? 0;
            const x1 = node.x1 ?? 0;
            const y0 = node.y0 ?? 0;
            const y1 = node.y1 ?? 0;
            const value = node.value ?? 0;
            // Labels point toward the middle: the spending side labels to its
            // left, over its own incoming band, so a middle column never writes
            // across the column beside it.
            const labelLeft = x0 > centerX;
            const dimmed = somethingActive && activeNode !== null && activeNode !== i
              && !sankeyData.links.some((link, index) => linkIsActive(link, index)
                && ((link.source as LaidOutNode).index === i || (link.target as LaidOutNode).index === i));
            const emphasised = node.kind === 'total' || node.kind === 'savings';
            const percent = share(value, total);
            return (
              <g
                key={i}
                opacity={dimmed ? 0.45 : 1}
                style={{ transition: 'opacity 150ms ease-out' }}
                onMouseEnter={(event) => {
                  setActiveNode(i);
                  showTooltip(event, node.name, value);
                }}
                onMouseMove={(event) => showTooltip(event, node.name, value)}
                onMouseLeave={clear}
              >
                <rect
                  x={x0}
                  y={y0}
                  width={x1 - x0}
                  height={Math.max(1, y1 - y0)}
                  rx={1}
                  fill={nodeColor(node)}
                />
                <text
                  x={labelLeft ? x0 - 8 : x1 + 8}
                  y={(y0 + y1) / 2}
                  dy="0.35em"
                  textAnchor={labelLeft ? 'end' : 'start'}
                  fontSize={12}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  <tspan fill="var(--foreground)" fontWeight={emphasised ? 600 : 400}>
                    {clip(node.name, compact ? 16 : 30)}
                  </tspan>
                  {/* The total is stated once, in the card header. */}
                  {!compact && node.kind !== 'total' && (
                    <tspan
                      dx={8}
                      fill="var(--foreground-secondary)"
                      fontFamily="var(--font-mono, 'JetBrains Mono', monospace)"
                      fontSize={11}
                      style={{ fontFeatureSettings: "'tnum'" }}
                    >
                      {money(value)}
                    </tspan>
                  )}
                  {!compact && percent && node.kind !== 'total' && (
                    <tspan
                      dx={6}
                      fill="var(--foreground-muted)"
                      fontFamily="var(--font-mono, 'JetBrains Mono', monospace)"
                      fontSize={11}
                      style={{ fontFeatureSettings: "'tnum'" }}
                    >
                      {percent}
                    </tspan>
                  )}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {tooltip && (
        <div
          role="presentation"
          style={{
            position: 'absolute',
            left: Math.min(tooltip.x + 12, Math.max(0, dimensions.width - 220)),
            top: tooltip.y + 12,
            maxWidth: 220,
            background: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 12,
            color: 'var(--foreground)',
            pointerEvents: 'none',
            zIndex: 20,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
          }}
        >
          <div style={{ fontWeight: 600 }}>{tooltip.title}</div>
          <div
            style={{
              marginTop: 2,
              color: 'var(--foreground-secondary)',
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontFeatureSettings: "'tnum'",
            }}
          >
            {money(tooltip.value)}
            {share(tooltip.value, total) && ` · ${share(tooltip.value, total)} of income`}
          </div>
        </div>
      )}
    </div>
  );
}
