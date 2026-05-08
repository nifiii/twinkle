import fs from 'fs/promises';
import path from 'path';

const TEMP_DIR = path.join(process.cwd(), 'uploads', 'temp');
const CHUNK_RETENTION_HOURS = 24; // 保留24小时

export interface CleanupStats {
  deletedDirs: number;
  deletedFiles: number;
  freedSpace: number;
}

/**
 * 清理过期的临时分片目录
 * 删除超过 CHUNK_RETENTION_HOURS 未修改的目录
 */
export async function cleanupTempChunks(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    deletedDirs: 0,
    deletedFiles: 0,
    freedSpace: 0,
  };

  try {
    // 检查临时目录是否存在
    await fs.access(TEMP_DIR);
  } catch {
    // 目录不存在，无需清理
    return stats;
  }

  try {
    const entries = await fs.readdir(TEMP_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const chunkDir = path.join(TEMP_DIR, entry.name);

      try {
        // 获取目录修改时间
        const stat = await fs.stat(chunkDir);
        const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);

        // 删除超过保留期的目录
        if (ageHours > CHUNK_RETENTION_HOURS) {
          const files = await fs.readdir(chunkDir);

          // Calculate space before deletion
          let dirSpace = 0;
          for (const file of files) {
            const filePath = path.join(chunkDir, file);
            const fileStat = await fs.stat(filePath);
            dirSpace += fileStat.size;
          }

          // Delete first
          await fs.rm(chunkDir, { recursive: true });

          // Then increment stats (only after success)
          stats.deletedDirs++;
          stats.deletedFiles += files.length;
          stats.freedSpace += dirSpace;

          console.log(`清理过期分片: ${entry.name} (${files.length} 个文件, ${(dirSpace / 1024 / 1024).toFixed(2)} MB)`);
        }
      } catch (error) {
        console.error(`清理目录失败 ${entry.name}:`, error);
      }
    }

    if (stats.deletedDirs > 0) {
      console.log(`临时文件清理完成: 删除 ${stats.deletedDirs} 个目录, ${stats.deletedFiles} 个文件, 释放 ${(stats.freedSpace / 1024 / 1024).toFixed(2)} MB`);
    }

  } catch (error) {
    console.error('清理临时文件失败:', error);
  }

  return stats;
}
