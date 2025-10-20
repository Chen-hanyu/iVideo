<template>
  <section class="timeline">
    <div class="timeline-header">
      <div class="timecode"></div>
      <div class="timeline-actions">
        <div class="action-group">
          <button class="action-btn" data-action="split" title="分割 (S)">✂ 分割</button>
          <button class="action-btn" data-action="delete" title="删除 (Delete)">⌫ 删除</button>
          <span class="sep"></span>
          <button class="action-btn" data-action="undo" title="后退 (Ctrl+Z)">↶ 后退</button>
          <button class="action-btn" data-action="redo" title="前进 (Ctrl+Y)">↷ 前进</button>
          <span class="sep"></span>
          <span class="track-add">添加轨道:</span>
          <button class="action-btn" data-action="add-track" data-type="video">+ 视频</button>
          <button class="action-btn" data-action="add-track" data-type="audio">+ 音频</button>
          <button class="action-btn" data-action="add-track" data-type="text">+ 文本</button>
          <button class="action-btn" data-action="add-track" data-type="sticker">+ 贴图</button>
        </div>
        <div class="zoom-group">
          <label>帧缩放</label>
          <input data-role="zoom" type="range" min="0.2" max="40" step="0.1" value="6" />
          <label style="margin-left:12px;">轨道高度</label>
          <input data-role="track-height" type="range" min="36" max="140" value="56" />
        </div>
      </div>
    </div>
    <div class="scroll">
      <div class="content" data-role="content">
        <div class="ruler" data-role="ruler"></div>
        <div class="tracks" data-role="tracks"></div>
        <div class="playhead" data-role="playhead"></div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { initTimeline } from '../../core/timeline'

onMounted(() => {
  const root = document.querySelector('section.timeline') as HTMLElement
  if (root) initTimeline(root)
})
</script>
