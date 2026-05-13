"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface DataPoint {
  date: string;
  value: number;
}

interface Props {
  data: DataPoint[];
  height?: number;
  color?: string;
}

export function Sparkline({ data, height = 60, color = "#E8923C" }: Props) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data.map((d) => d.value));
  const max = Math.max(...data.map((d) => d.value));
  const padding = (max - min) * 0.15 || 1;

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={[min - padding, max + padding]} />
          <Tooltip
            cursor={{ stroke: "#fff", strokeOpacity: 0.3, strokeDasharray: "2 2" }}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const p = payload[0];
              const date = p.payload?.date;
              const v = Number(p.value || 0);
              return (
                <div className="bg-cc-navy-deep text-white text-xs px-2.5 py-1.5 rounded-md shadow-lg border border-white/10">
                  <div className="font-semibold tabular-nums">${(v / 1000).toFixed(0)}K</div>
                  <div className="text-white/70 text-[10px]">{date}</div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.6}
            fill="url(#spark-grad)"
            dot={false}
            activeDot={{ r: 4, fill: color, stroke: "#fff", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
