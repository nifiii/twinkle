import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * 提取 PDF 封面或选定前几页并保存为图片 (使用 pdftoppm 工具)
 * @param pdfBuffer PDF 文件 Buffer 或路径
 * @param outputDir 输出目录
 * @param pageCount 提取的总页数 (默认 1)
 * @returns 生成的图片文件名列表
 */
export async function extractPagesAsImages(
  pdfBuffer: Buffer | string,
  outputDir: string,
  pageCount: number = 1
): Promise<string[]> {
  let tempPdfPath: string | null = null;

  try {
    // 1. 准备 PDF 文件路径
    let inputPdfPath: string;

    if (Buffer.isBuffer(pdfBuffer)) {
      // 如果是 Buffer，需要先写入临时文件
      const tempId = uuidv4();
      tempPdfPath = path.join(outputDir, `temp-${tempId}.pdf`);
      await fs.writeFile(tempPdfPath, pdfBuffer);
      inputPdfPath = tempPdfPath;
    } else if (typeof pdfBuffer === 'string') {
      inputPdfPath = pdfBuffer;
    } else {
      throw new Error('无效的 PDF 数据');
    }

    // 确保输出目录存在
    await fs.mkdir(outputDir, { recursive: true });

    // 2. 生成唯一的输出文件前缀
    const outputPrefix = `cover-${uuidv4()}`;
    const outputBasePath = path.join(outputDir, outputPrefix);

    // 3. 执行 pdftoppm 命令
    // 如果 pageCount <= 0，则提取全部页面，不加 -f 1 -l N 的限制
    const pageFlags = pageCount > 0 ? `-f 1 -l ${pageCount}` : '';
    const command = `pdftoppm -jpeg ${pageFlags} "${inputPdfPath}" "${outputBasePath}"`;

    console.log(`执行页面提取命令 (共 ${pageCount} 页):`, command);
    const { stdout, stderr } = await execAsync(command);

    if (stderr) {
      console.warn('pdftoppm stderr:', stderr);
    }

    // 4. 确定生成的文件名
    const files = await fs.readdir(outputDir);
    const generatedFileNames = files
      .filter(f => f.startsWith(outputPrefix) && f.endsWith('.jpg'))
      .sort(); // 默认排序如 -1.jpg, -2.jpg

    if (generatedFileNames.length === 0) {
      console.error('pdftoppm 输出目录内容:', files);
      throw new Error(`页面生成失败，在目录 ${outputDir} 中未找到前缀为 ${outputPrefix} 的 .jpg 文件`);
    }

    const finalFileNames: string[] = [];

    // 5. 分别重命名并回传
    for (let i = 0; i < generatedFileNames.length; i++) {
      const generatedFilePath = path.join(outputDir, generatedFileNames[i]);
      const finalFileName = `${outputPrefix}-p${i + 1}.jpg`;
      const finalFilePath = path.join(outputDir, finalFileName);

      await fs.rename(generatedFilePath, finalFilePath);
      finalFileNames.push(finalFileName);
    }

    return finalFileNames;

  } catch (error) {
    console.error('封面提取失败:', error);
    // 抛出错误让上层处理
    throw error;
  } finally {
    // 清理临时 PDF 文件 (如果是我们创建的)
    if (tempPdfPath) {
      try {
        await fs.unlink(tempPdfPath);
      } catch (e) {
        console.warn('清理临时 PDF 文件失败:', e);
      }
    }
  }
}
