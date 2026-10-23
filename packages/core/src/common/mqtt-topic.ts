/** MQTT 主题名不能包含通配符，且不能为空。 */
export function isValidMqttTopicName(topic: string): boolean {
  return topic.length > 0 && !/[+#\u0000]/.test(topic);
}

/** MQTT 主题过滤器中的通配符必须独占一个层级，# 只能位于末尾。 */
export function isValidMqttTopicFilter(filter: string): boolean {
  if (filter.length === 0 || filter.includes('\u0000')) return false;
  const levels = filter.split('/');
  return levels.every((level, index) => {
    if (level.includes('#')) return level === '#' && index === levels.length - 1;
    return !level.includes('+') || level === '+';
  });
}

/** 按 MQTT 3.1.1 的单层 + 和末尾多层 # 语义匹配主题。 */
export function mqttTopicMatchesFilter(topic: string, filter: string): boolean {
  if (!isValidMqttTopicName(topic) || !isValidMqttTopicFilter(filter)) return false;

  const topicLevels = topic.split('/');
  const filterLevels = filter.split('/');
  if (
    topic.startsWith('$') &&
    !filter.startsWith('$') &&
    (filterLevels[0] === '+' || filterLevels[0] === '#')
  ) {
    return false;
  }

  for (let index = 0; index < filterLevels.length; index += 1) {
    const filterLevel = filterLevels[index]!;
    if (filterLevel === '#') return true;
    const topicLevel = topicLevels[index];
    if (topicLevel === undefined) return false;
    if (filterLevel !== '+' && filterLevel !== topicLevel) return false;
  }

  return topicLevels.length === filterLevels.length;
}
