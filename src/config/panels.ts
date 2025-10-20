export type Field = {
  key: string
  label: string
  type: 'number' | 'slider' | 'switch' | 'text' | 'color'
  min?: number
  max?: number
  step?: number
  default?: any
}

export type PanelConfig = Record<string, { groups: { title: string; fields: Field[] }[] }>

const panels: PanelConfig = {
  video: {
    groups: [
      { title: '播放', fields: [
        { key: 'speed', label: '变速', type: 'slider', min: 0.25, max: 4, step: 0.05, default: 1 },
      ]},
      { title: '基础', fields: [
        { key: 'opacity', label: '不透明度', type: 'slider', min: 0, max: 1, step: 0.01, default: 1 },
      ]}
      ,
      { title: '美化', fields: [
        { key: 'exposure', label: '曝光', type: 'slider', min: -2, max: 2, step: 0.01, default: 0 },
        { key: 'contrast', label: '对比度', type: 'slider', min: 0, max: 2, step: 0.01, default: 1 },
        { key: 'saturation', label: '饱和度', type: 'slider', min: 0, max: 2, step: 0.01, default: 1 },
        { key: 'sharpen', label: '锐化', type: 'slider', min: 0, max: 1, step: 0.01, default: 0 },
        { key: 'temperature', label: '色温', type: 'slider', min: 2000, max: 9000, step: 50, default: 6500 }
      ]}
    ]
  },
  audio: {
    groups: [
      { title: '音量', fields: [
        { key: 'gain', label: '增益(dB)', type: 'number', min: -60, max: 6, step: 1, default: 0 },
        { key: 'mute', label: '静音', type: 'switch', default: false },
      ]}
    ]
  },
  text: {
    groups: [
      // 移除位置与时间，时间由片段决定，位置由预览中拖拽
      { title: '样式', fields: [
        { key: 'content', label: '内容', type: 'text', default: '文字' },
        { key: 'color', label: '颜色', type: 'color', default: '#ffffff' },
        // 简化：移除不稳定的字号/不透明度，新增字重与描边
        { key: 'bold', label: '加粗', type: 'switch', default: true },
        { key: 'outline', label: '描边', type: 'switch', default: true },
        { key: 'outlineColor', label: '描边色', type: 'color', default: '#000000' }
      ]}
    ]
  },
  sticker: {
    groups: [
      { title: '位置', fields: [
        { key: 'x', label: 'X', type: 'number', min: -1000, max: 1000, step: 1, default: 0 },
        { key: 'y', label: 'Y', type: 'number', min: -1000, max: 1000, step: 1, default: 0 },
        { key: 'scale', label: '缩放', type: 'slider', min: 0.1, max: 8, step: 0.1, default: 1 },
        { key: 'rotation', label: '旋转(°)', type: 'number', min: -180, max: 180, step: 1, default: 0 }
      ]},
      { title: '时间', fields: [
        { key: 'start', label: '开始(帧)', type: 'number', min: 0, max: 100000, step: 1, default: 0 },
        { key: 'end', label: '结束(帧)', type: 'number', min: 1, max: 100000, step: 1, default: 60 }
      ]},
      { title: '基础', fields: [
        { key: 'opacity', label: '不透明度', type: 'slider', min: 0, max: 1, step: 0.01, default: 1 }
      ]}
    ]
  },
}

export default panels
