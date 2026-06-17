// ============================================
// Claude API 整合 — 取得單字的完整解釋
// ============================================

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

// 結構化輸出 schema — 確保 Claude 回傳格式固定
const WORD_EXPLANATION_SCHEMA = {
  type: "object",
  properties: {
    word: { type: "string", description: "原單字" },
    language: { type: "string", description: "單字語言" },
    pronunciation: {
      type: "string",
      description: "發音(IPA 音標或羅馬拼音,沒有就填空字串)"
    },
    meanings: {
      type: "array",
      description: "依詞性分類的意思",
      items: {
        type: "object",
        properties: {
          partOfSpeech: { type: "string", description: "詞性(名詞、動詞等)" },
          chineseTranslations: {
            type: "array",
            description: "該詞性下所有中文意思",
            items: { type: "string" }
          },
          englishDefinition: {
            type: "string",
            description: "該詞性的英文簡短解釋"
          }
        },
        required: ["partOfSpeech", "chineseTranslations", "englishDefinition"],
        additionalProperties: false
      }
    },
    examples: {
      type: "array",
      description: "3 個不同情境的例句",
      items: {
        type: "object",
        properties: {
          sentence: { type: "string", description: "例句(原文)" },
          translation: { type: "string", description: "中文翻譯" },
          context: { type: "string", description: "使用情境,如:日常對話、商務、文學等" }
        },
        required: ["sentence", "translation", "context"],
        additionalProperties: false
      }
    },
    nuance: {
      type: "object",
      description: "語感說明 — 分成四部分以方便顯示",
      properties: {
        coreFeel: {
          type: "string",
          description: "核心語感:整體感覺、語氣、形象、字源延伸的意象(一段話)"
        },
        synonymDifferences: {
          type: "array",
          description: "和近義詞的差別,逐一列出比較(至少 2-4 個近義詞)",
          items: {
            type: "object",
            properties: {
              word: { type: "string", description: "近義詞" },
              difference: { type: "string", description: "差別說明" }
            },
            required: ["word", "difference"],
            additionalProperties: false
          }
        },
        collocations: {
          type: "array",
          description: "常見搭配/慣用句型(至少 3-5 個)",
          items: {
            type: "object",
            properties: {
              pattern: { type: "string", description: "搭配/慣用句型(原文)" },
              meaning: { type: "string", description: "中文意思" }
            },
            required: ["pattern", "meaning"],
            additionalProperties: false
          }
        },
        culturalContext: {
          type: "string",
          description: "文化背景、使用場合、何時用何時不用,沒有特別文化背景就填空字串"
        }
      },
      required: ["coreFeel", "synonymDifferences", "collocations", "culturalContext"],
      additionalProperties: false
    },
    wordForms: {
      type: "string",
      description: "詞形變化(動詞三態、名詞複數、形容詞比較級等),無變化填「無」"
    }
  },
  required: ["word", "language", "pronunciation", "meanings", "examples", "nuance", "wordForms"],
  additionalProperties: false
};

/**
 * 呼叫 Claude API 取得單字的完整解釋
 */
async function fetchWordExplanation(word, language) {
  const settings = loadSettings();
  if (!settings.apiKey || settings.apiKey.startsWith("在這裡") || settings.apiKey.length < 20) {
    throw new Error("請先到「設定」填入你的 Claude API key");
  }

  const userPrompt = `請詳細解釋這個${language}單字:「${word}」

請以 ${settings.nativeLanguage} 為母語的學習者為對象,提供以下內容:

1. **發音**:IPA 音標(日文請給羅馬拼音+假名,韓文給羅馬拼音)
2. **詞性分類**:若有多個詞性(例如同時是名詞和動詞),分開列出,每個詞性下列出所有對應的中文意思
3. **英文解釋**:用英文簡短解釋這個字
4. **3 個例句**:不同情境(日常 / 正式 / 文學等),每句附中文翻譯與情境說明
5. **語感(分成四部分)**
   - **coreFeel**:核心語感、感覺、整體形象,可說明字源延伸的意象(一段完整描述)
   - **synonymDifferences**:列出 2–4 個近義詞,逐一比較細微差別
   - **collocations**:列出 3–5 個常見搭配或慣用句型,每個附中文意思
   - **culturalContext**:文化背景、使用場合,沒有就填空字串
6. **詞形變化**:動詞三態、名詞複數、形容詞比較級等,無變化填「無」

請完整、實用,專注在幫助學習者真正掌握這個字的「感覺」。`;

  const requestBody = {
    model: settings.model,
    max_tokens: 4096,
    messages: [
      { role: "user", content: userPrompt }
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: WORD_EXPLANATION_SCHEMA
      }
    }
  };

  const response = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMsg = `API 錯誤 (${response.status})`;
    try {
      const err = JSON.parse(errorText);
      errorMsg += `: ${err.error?.message || errorText}`;
    } catch {
      errorMsg += `: ${errorText}`;
    }
    throw new Error(errorMsg);
  }

  const data = await response.json();
  const textBlock = data.content.find(b => b.type === "text");
  if (!textBlock) {
    throw new Error("Claude 回傳沒有文字內容");
  }

  const explanation = JSON.parse(textBlock.text);
  explanation._usage = {
    input_tokens: data.usage.input_tokens,
    output_tokens: data.usage.output_tokens,
    cache_read_input_tokens: data.usage.cache_read_input_tokens || 0,
    cache_creation_input_tokens: data.usage.cache_creation_input_tokens || 0
  };

  return explanation;
}
