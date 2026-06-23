/** Keep in sync with server/usageQuota.js computeChatCreditCost */
export function computeChatCreditCost(options = {}) {
  const imageCount = Math.max(0, Number(options.imageCount) || 0);
  let cost = imageCount > 0 ? imageCount : 1;
  if (options.useResumeContext) {
    cost *= 2;
  }
  return cost;
}

export function formatCreditCostHint(options = {}) {
  const cost = computeChatCreditCost(options);
  const imageCount = Math.max(0, Number(options.imageCount) || 0);
  if (imageCount > 1) {
    return `${imageCount} 张图，本次消耗 ${cost} 次`;
  }
  return `本次消耗 ${cost} 次`;
}
