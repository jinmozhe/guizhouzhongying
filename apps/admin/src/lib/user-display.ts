/**
 * 判断是否为微信小程序静默建号生成的超长随机用户名（如 wx_<32位hex>）。
 */
export function isWechatGeneratedUsername(username?: string | null): boolean {
  if (!username) return false;
  return username.startsWith("wx_") && username.length > 12;
}

/**
 * 列表场景下格式化用户名：
 * 微信自动生成的 wx_ 超长账号直接展示最后 12 位，普通短用户名原样展示。
 */
export function formatUsernameForList(username?: string | null): string {
  if (!username) return "";
  if (isWechatGeneratedUsername(username)) {
    return username.slice(-12);
  }
  return username;
}

/**
 * 获取用户主展示名称：
 * 优先显示昵称；无昵称且为微信系统账号时与小程序保持一致显示“微信商城用户”；普通账号回退显示用户名。
 */
export function formatUserPrimaryName(user: {
  display_name?: string | null;
  username?: string | null;
  id?: string | null;
  user_id?: string | null;
}): string {
  const displayName = user.display_name?.trim();
  if (displayName) return displayName;
  if (isWechatGeneratedUsername(user.username)) return "微信商城用户";
  return user.username?.trim() || user.id || user.user_id || "未知用户";
}
