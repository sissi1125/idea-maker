/**
 * 测试文档预处理
 *
 * 在文档进入 RAG pipeline 之前做一次清洗，去除对 chunk/embedding 有害的噪声。
 * 与 pipeline 内部的 preprocess stage（markdown-structure 等）不同：
 *   - 这里是"文档级"的结构性过滤，决定哪些内容进入测试
 *   - pipeline 内部的 preprocess 是"文本级"的格式归一化
 */

export interface PreprocessingConfig {
  /** 删除 ```mermaid ... ``` 代码块（流程图文本噪声大，embedding 质量差） */
  removeMermaid?: boolean;
  /** 删除所有代码块（```lang ... ```），保留行内代码 */
  removeCodeBlocks?: boolean;
  /** 只保留指定标题之后的内容（例如 "## 产品功能需求"） */
  extractAfterHeading?: string;
  /** 最大字符数，0 = 不限制 */
  maxChars?: number;
}

export function preprocessDoc(text: string, config: PreprocessingConfig): {
  text: string;
  log: string[];
} {
  const log: string[] = [];
  let result = text;

  // 1. 提取指定标题之后的内容
  if (config.extractAfterHeading) {
    const idx = result.indexOf(config.extractAfterHeading);
    if (idx === -1) {
      log.push(`⚠ 未找到标题 "${config.extractAfterHeading}"，保留完整文档`);
    } else {
      const before = result.slice(0, idx).length;
      result = result.slice(idx);
      log.push(`✓ extractAfterHeading: 跳过前 ${before} 字符，从 "${config.extractAfterHeading}" 开始`);
    }
  }

  // 2. 删除 Mermaid 代码块
  if (config.removeMermaid) {
    const before = result.length;
    result = result.replace(/```mermaid[\s\S]*?```/g, "");
    const removed = before - result.length;
    if (removed > 0) {
      log.push(`✓ removeMermaid: 删除 ${removed} 字符`);
    }
  }

  // 3. 删除所有代码块（保留行内代码）
  if (config.removeCodeBlocks) {
    const before = result.length;
    result = result.replace(/```[\s\S]*?```/g, "");
    const removed = before - result.length;
    if (removed > 0) {
      log.push(`✓ removeCodeBlocks: 删除 ${removed} 字符`);
    }
  }

  // 4. 多余空行压缩（删除连续 3 个以上空行，避免 chunk 里大量空白）
  result = result.replace(/\n{3,}/g, "\n\n");

  // 5. 截断
  if (config.maxChars && config.maxChars > 0 && result.length > config.maxChars) {
    result = result.slice(0, config.maxChars);
    log.push(`✓ maxChars: 截断至 ${config.maxChars} 字符`);
  }

  log.push(`最终文档长度: ${result.length} 字符`);
  return { text: result, log };
}
