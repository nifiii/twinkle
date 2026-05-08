/**
 * 计算文件的 SHA-256 哈希值
 * @param file - File 对象或 Blob 对象
 * @returns 十六进制哈希字符串
 */
export async function calculateFileHash(file: File | Blob): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * 计算 Base64 字符串的 SHA-256 哈希值
 * @param base64 - 图片的 Base64 字符串
 * @returns 十六进制哈希字符串
 */
export async function calculateBase64Hash(base64: string): Promise<string> {
  // 去掉 Base64 前缀
  const base64Content = base64.replace(/^data:image\/\w+;base64,/, '');
  
  // 将 base64 转换为二进制
  const binaryString = atob(base64Content);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes.buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}
