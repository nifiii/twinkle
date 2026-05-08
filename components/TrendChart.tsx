// @ts-nocheck - Recharts type compatibility issue with React 18 + TypeScript 5.2
// components/TrendChart.tsx
import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface TrendData {
  date: string;
  count: number;
}

interface TrendChartProps {
  data: TrendData[];
}

export const TrendChart: React.FC<TrendChartProps> = ({ data }) => {
  return (
    <ResponsiveContainer width="100%" height={150}>
      <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12 }}
          stroke="#94a3b8"
        />
        <YAxis
          tick={{ fontSize: 12 }}
          stroke="#94a3b8"
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: '#fff',
            borderRadius: '4px',
            fontSize: '12px'
          }}
        />
        <Line
          type="monotone"
          dataKey="count"
          stroke="#4A90E2"
          strokeWidth={2}
          dot={{ fill: "#4A90E2", strokeWidth: 2, r: 4 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};
