import '@tarojs/taro'

declare module '@tarojs/taro' {
  interface PageConfig {
    /**
     * 微信原生组件的占位映射；Taro 4.3.0 尚未声明此配置字段。
     * @see https://developers.weixin.qq.com/miniprogram/dev/framework/custom-component/placeholder.html
     */
    componentPlaceholder?: Record<string, string>
  }
}
