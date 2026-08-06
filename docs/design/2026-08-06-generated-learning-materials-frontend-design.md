# 已生成学习资料：前端设计

状态：Gate 3 已确认

## 1. 背景

路由由现有 hash 状态 `resources/generated` 管理，资料页不读取书架列表作为内容来源。

## 2. 目标

前端只消费生成资料专用 API；删除成功后局部移除项目并保留筛选状态。

## 3. 方案

| 区域 | 职责 |
|---|---|
| `ResourcesShell` | 注册 `generated` 子路由与 Tab。 |
| `GeneratedMaterialsHub` | 加载分页、学科/进度筛选、列表、空/错/加载状态和删除确认。 |
| `GeneratedMaterialRow` | 显示资料信息、继续学习、更多菜单。 |
| API 客户端 | 请求 `/api/generated-learning-materials` 与删除端点；不直接访问 SQLite 或旧课堂实体。 |

筛选改变时取消旧请求结果；删除期间禁用当前行菜单和确认按钮；`410 learning_content_retired` 视为幂等成功后刷新列表。路由继续学习复用现有 `#tutor/task/:id`。

## 4. 风险

不得把失败任务混入已生成资料页；失败任务只在智慧课堂按失败语义显示。
