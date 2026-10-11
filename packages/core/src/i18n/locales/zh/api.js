/**
 * Text for API responses (packages/server): errors, rate limits, address lookups, and the template
 * answer for an agenda item. Every error response also carries a stable code, so the web app can
 * show its own dictionary text instead of this one.
 */
export default {
  rateLimited: '过去1分钟内，来自你所在网络的请求太多。连接同一个 Wi-Fi 的所有人会合并计算，所以请{n}秒后再试。',
  notFound: '未找到',
  invalidJson: '请求正文不是有效的 JSON。',
  bodyTooLarge: '请求太大。',
  serverError: '服务器出了问题。请稍后再试。',
  invalidField: '字段“{field}”必须是文本。',
  invalidBody: '请以 JSON 对象的形式发送请求。',
  missingQuery: '请输入要查询的邮编或地址。',
  missingTitle: '请发送你想要解释的议程事项标题。',
  geoNotFound: "我们在 Dallas-Fort Worth 地区找不到这个地点。请检查拼写，或试试邮编或你所在城市的名称。",
  geoOutside: '{place}不在 Agora 覆盖的 Dallas-Fort Worth 地区内。请改从列表中选择一个城市。',
  geoOutsideZip: '邮编{zip}不在 Agora 覆盖的 Dallas-Fort Worth 地区内。请改从列表中选择一个城市。',
  geoBusy: '地址查询现在很忙。请过几秒再试。',
  geoUnavailable: "地址查询暂时不可用。请改从列表中选择你的城市；距离将从该市的市政厅开始计算。",
  explainOnAgenda: '这个事项在市议会的议程上。',
  explainWeighIn: '如果想表达意见，请在会议开始前报名公众发言。',
};
