## **图书馆图书内容加载失效定位与修复方案**

经过对 `deploy.sh` 部署脚本及远程 Linux 环境（47.79.4.52）的深度分析，确认了问题的核心逻辑。

### **1. 根因定位 (Root Cause)**

*   **异步转换状态断点**：在 [saveBook.ts](file:///d:/devops/HL-os/backend/src/routes/saveBook.ts) 中，Markdown 转换是后台异步执行的。如果 AI 转换过程由于文本过长（如语文教材）导致超时或失败，系统仍会将状态更新为 `completed`（完成），但 `mdPath` 为空。
*   **路径解析脆弱性**：[BookReader.tsx](file:///d:/devops/HL-os/components/BookReader.tsx) 的 `getFileUrl` 逻辑强依赖于硬编码的前缀 `/opt/hl-os/data`。如果后端返回的路径格式略有差异（例如多了一个斜杠或使用了相对路径），前端将无法将其转换为可访问的 `/data/...` URL。
*   **双重映射风险**：部署环境使用了 Nginx 代理 + 后端静态服务。如果前端拿到的路径解析错误，请求将无法通过 Nginx 正确到达后端的 `/data` 映射。

***

### **2. 修复计划**

#### **第一阶段：前端路径解析器加固 (核心修复)**
1.  **重构 `getFileUrl` 逻辑**：在 [BookReader.tsx](file:///d:/devops/HL-os/components/BookReader.tsx) 中，将其改为**基于关键字的智能解析**。
    *   不再比对完整前缀，而是寻找路径中的 `obsidian/` 或 `originals/`。
    *   自动将这些关键路径及其后的内容拼接为 `/data/...`。
    *   确保无论后端返回绝对路径还是相对路径，前端都能生成正确的 URL。

#### **第二阶段：后端转换状态与日志优化**
1.  **修复异常状态转换**：修改 [saveBook.ts](file:///d:/devops/HL-os/backend/src/routes/saveBook.ts)，当 Markdown 转换失败时，将数据库状态标记为 `failed` 而非 `completed`。
2.  **增加转换审计日志**：在转换开始、结束及失败时增加详细的控制台输出，以便通过 `journalctl -u hl-backend -f` 实时观察转换进度。

#### **第三阶段：服务端排查建议 (供用户执行)**
1.  **检查转换状态**：建议运行 `sqlite3 /opt/hl-os/data/hlos.db "SELECT id, title, status, mdPath FROM books ORDER BY timestamp DESC LIMIT 5;"` 查看最新上传图书的实际入库状态。
2.  **查看实时日志**：运行 `journalctl -u hl-backend -n 100 --no-pager` 查看 AI 转换是否报错。

***

### **3. 预期效果**
修复后，阅读器将能兼容各种路径格式，正确加载 Markdown 内容。对于转换失败的图书，界面将显示“处理失败”，方便用户重新尝试或检查 AI 配置。

**请确认是否按此计划执行代码修复？**
