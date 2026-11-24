import palette from './palette.json'

// Native component props and native dialogs cannot consume Sass variables.
export const colors = {
  ...palette,
  danger: palette.rewardInk,
  warning: palette.rewardInk,
} as const

export const modalColors = { confirmColor: colors.primary, cancelColor: colors.secondary }
export const dangerModalColors = { confirmColor: colors.danger, cancelColor: colors.secondary }
export const richTextStyle = `font-size: 14px; line-height: 1.7; color: ${colors.text}; overflow-wrap: anywhere;`
