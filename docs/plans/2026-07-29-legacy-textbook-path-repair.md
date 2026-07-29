# 历史三年级教材路径修复运行记录

## 背景

四本历史三年级教材记录保留了旧数据根目录 `/opt/hl-os/data`，而生产容器当前挂载目录为 `/opt/twinkle/data`。后端读取原 PDF 大小时 `stat` 旧路径失败，书架显示 `0 B`，但记录状态仍为“已索引”。语文三下还缺少对应 Markdown 解析产物。

## 目标

在不删除或新建书籍、课堂任务、错题、试卷的前提下：

- 修复科学、英语、数学、语文三下的原 PDF 路径。
- 修复前三本已有 Markdown 的路径。
- 使用生产 `.env` 中已配置的火山方舟模型，重新解析语文三下并生成目录。
- 保留既有书籍 ID、上传时间及所有关联数据。

## 方案

执行一次性脚本 `backend/src/scripts/migrateLegacyTextbookPaths.ts`：

1. 只处理四个固定书籍 ID，并验证每个映射后的原 PDF 存在且大于 `0` 字节。
2. 对科学、英语、数学三下同时验证已有 Markdown。
3. 在 `--apply` 前备份 `hlos.db` 与存在的 `metadata.json` 到 `data/migrations/2026-07-29_repair_legacy_textbook_paths/`。
4. 语文三下完成 OCR 正文与目录提取后，才在一个 SQLite 事务中写入四条记录；任何解析失败不会把语文标记为已完成。
5. 写后再次验证四本 PDF、四份 Markdown、四条 `completed` 状态及语文目录。

生产执行（部署包含脚本的镜像后）：

```bash
docker exec twinkle node dist/scripts/migrateLegacyTextbookPaths.js
docker exec twinkle node dist/scripts/migrateLegacyTextbookPaths.js --apply
curl -fsS 'http://127.0.0.1:3000/api/books?ownerId=child_1'
```

## 风险

- 语文 OCR 会调用已配置模型，耗时和模型额度取决于 PDF 页数。
- SQLite 写入前已有备份；若解析失败，不会写入语文记录。
- 脚本故意拒绝任何非四条固定记录、未知目录前缀、缺失文件或空文件，避免扩散修复范围。

## 回滚

停止服务后，用本次备份中的 `hlos-*.db` 替换 `/opt/twinkle/data/hlos.db`；若本次备份包含 `metadata-*.json`，同时恢复该文件。随后启动容器并重新检查书架。

## FAQ

**为什么不重新上传四本教材？**

原始 PDF 已存在于当前数据卷；重传会产生新 ID，破坏已有学习任务和错题关联。

**为什么只重解析语文三下？**

前三本的 Markdown 已存在，只是路径仍指向旧根目录。语文三下没有 Markdown，必须补齐可供章节学习读取的正文和目录。
