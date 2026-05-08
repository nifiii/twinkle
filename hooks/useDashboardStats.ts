// hooks/useDashboardStats.ts
import { useMemo } from 'react';
import { ScannedItem } from '../types';

export interface DashboardStats {
  todayCount: number;
  weekCount: number;
  totalWrong: number;
  masteryRate: number;
  last7Days: {
    date: string;  // Format: "01-20"
    count: number;
  }[];
}

export const useDashboardStats = (scannedItems: ScannedItem[]): DashboardStats => {
  const stats = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const weekAgo = today - 7 * 24 * 60 * 60 * 1000;

    // 今日收录
    const todayCount = scannedItems.filter(
      item => item.timestamp >= today
    ).length;

    // 本周收录
    const weekCount = scannedItems.filter(
      item => item.timestamp >= weekAgo
    ).length;

    // 错题总数
    let totalWrong = 0;
    scannedItems.forEach(item => {
      if (item.meta.problems) {
        totalWrong += item.meta.problems.filter(
          p => p.status === 'wrong'
        ).length;
      }
    });

    // 掌握率
    let totalCorrect = 0;
    let totalWrongCount = 0;
    scannedItems.forEach(item => {
      if (item.meta.problems) {
        item.meta.problems.forEach(p => {
          if (p.status === 'correct') totalCorrect++;
          if (p.status === 'wrong') totalWrongCount++;
        });
      }
    });

    const masteryRate = totalCorrect + totalWrongCount > 0
      ? Math.round((totalCorrect / (totalCorrect + totalWrongCount)) * 100)
      : 0;

    // 最近7天趋势
    const last7Days: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today - i * 24 * 60 * 60 * 1000);
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime();
      const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();

      const count = scannedItems.filter(
        item => item.timestamp >= dayStart && item.timestamp <= dayEnd
      ).length;

      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${month}-${day}`;

      last7Days.push({ date: dateStr, count });
    }

    return {
      todayCount,
      weekCount,
      totalWrong,
      masteryRate,
      last7Days
    };
  }, [scannedItems]);

  return stats;
};
