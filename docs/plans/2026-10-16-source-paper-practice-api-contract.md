# 母卷原创测试：API契约

## 1. 背景

依据本轮PRD、前端设计及技术设计。授权/归属口径沿用ownerId，非安全认证。JSON响应沿用`{success:true,data}`或`{success:false,errorCode,error,field?}`。

## 2. 目标

查询不产生模型费用；分析与创建可恢复、幂等、明确失败；不会把母卷伪装为教材章节或奥数。

## 3. 方案

| Method / Path | 请求与返回 |
| --- | --- |
| GET `/api/assistant/source-papers?ownerId=...` | 返回候选数组：id,title,subject,grade,status；仅归档资料库明确试卷来源。 |
| POST `/api/assistant/source-paper-analyses` | `{ownerId,bookId,requestKey}`；202返回分析{id,status,source,targetGrade,summary?,error?,taskId?}；重复key返回原对象，参数冲突409。正文外发当前.env模型，仅主动分析时执行。 |
| GET `/api/assistant/source-paper-analyses/:id?ownerId=...` | 返回同分析对象；未知404。status为running/ready/failed，失败带error缺项说明。counts为已受理生成的数量配置；taskRetired=true表示关联资料已删除，必须重新分析。 |
| GET `/api/assistant/source-paper-analyses?ownerId=...&requestKey=...` | 受理结果未知时按客户端已保存请求身份恢复；未受理404。 |
| POST `/api/learning-tasks` | `{ownerId,requestKey,taskType:"assessment",source:{kind:"source_paper",analysisId,counts:[6,4,10]}}`；202返回既有任务摘要。counts数组与摘要分区顺序一致，全部正整数；先校验来源版本/目标年级与完整性，再受理。 |
| GET `/api/learning-tasks/:id?ownerId=...` | 既有任务详情，增加source_paper来源；事件detail包含真实阶段及已完成/总批次。生成后链接assessment_paper。 |

结构摘要例：`{scope:"written_only",knowledgePoints:["句意理解"],sections:[{id:"s1",title:"选择题",questionKind:"选择",responseType:"choice",questionCount:6,groupCount:0,requiresMaterial:false}],issues:[],gradeAppropriate:true}`。源卷题组数不与子题数混算。此例为合成数据。

错误：400 invalid_source/grade_required/source_not_ready/invalid_counts；404 source_missing/analysis_missing；409 source_changed/request_conflict；422 source_incomplete/unsupported_structure；503 feature_disabled。任务供应商错误终态failed、generation_failed，安全文案不泄漏正文/堆栈。

创建唯一性绑定owner+requestKey及analysisId。明确失败重试使用新key并保留原分析/配置；运行中相同analysisId返回原任务，不能双建。数量变化/来源变化不能用旧key绕过校验。

新卷保持既有`content.sections[].questions[]`，可选增加`material,groupId,questionKind`；material在关联小题与提交快照中保持可读。答案、解析、学生作答逐题连续显示；不新增评分接口。既有预览/导出/删除路径不变。

## 4. 风险

进程内worker适合当前单实例家庭应用；重启标失败需显式重试，不能视作高可用队列。前端暂存请求身份、时间及已确认分区数量，不存母卷正文/原题或答案；未知受理时沿用原标识和原数量恢复。运行中任务15分钟上限与5分钟页面解锁分开。模型内容仍需人工抽查，结构校验不能保证语义绝对正确。
