// ============================================
// Claude API 整合 — 取得單字的完整解釋
// ============================================

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

// 結構化輸出 schema — 確保 Claude 回傳格式固定
const WORD_EXPLANATION_SCHEMA = {
  type: "object",
  properties: {
    typoCheck: {
      type: "object",
      description: "拼字錯誤偵測。若懷疑使用者輸入有錯,建議正確拼法。",
      properties: {
        isLikelyTypo: {
          type: "boolean",
          description: "使用者的輸入是否疑似拼字錯誤"
        },
        suggestedSpelling: {
          type: "string",
          description: "若是錯字,建議的正確拼法;否則填使用者原輸入"
        },
        confidence: {
          type: "string",
          enum: ["high", "medium", "low", "none"],
          description: "拼錯字判斷的信心度;none = 不是錯字"
        },
        reason: {
          type: "string",
          description: "簡短說明為什麼這可能是錯字(沒有就填空字串)"
        }
      },
      required: ["isLikelyTypo", "suggestedSpelling", "confidence", "reason"],
      additionalProperties: false
    },
    word: { type: "string", description: "最終以哪個拼字解釋(若有錯字判斷,填正確拼法)" },
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
  required: ["typoCheck", "word", "language", "pronunciation", "meanings", "examples", "nuance", "wordForms"],
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

  const userPrompt = `請解釋這個${language}單字:「${word}」

**0. 先判斷是否疑似拼字錯誤(typoCheck)**
- 仔細看使用者輸入的拼字。若疑似拼錯,設 isLikelyTypo: true,並在 suggestedSpelling 給正確拼法。
- confidence 分四級:
  - "high" = 顯然拼錯(如 serindipity → serendipity)
  - "medium" = 很可能拼錯,但也可能是罕見字
  - "low" = 微小可能拼錯
  - "none" = 拼字正確,不是錯字
- **若懷疑是錯字(high/medium),請以「正確拼法」回答後續所有欄位**(word、meanings、examples 等)
- reason 簡短說明判斷理由,例如「少一個 e」或「兩字母順序顛倒」

請以 ${settings.nativeLanguage} 為母語的學習者為對象,提供:

1. **發音**:IPA 音標(日文給羅馬拼音+假名,韓文給羅馬拼音)
2. **詞性與意思分類(重要!)**:
   - 若有多個詞性(例如同時是名詞和動詞),分開列出
   - **同一詞性下若有截然不同的意思(distinct senses),要分成多筆 meaning entry**,各自有自己的中文翻譯與英文解釋
   - 同一個意思內的同義詞才放在 chineseTranslations 陣列裡(用頓號等級)
   - 範例:unwind 的動詞有兩個截然不同的意思 → 列為兩筆:
     • 第 1 筆:partOfSpeech="動詞", chineseTranslations=["放鬆","紓壓"], englishDefinition="to relax and let go of stress"
     • 第 2 筆:partOfSpeech="動詞", chineseTranslations=["解開","卷開","展開"], englishDefinition="to unfold something that is wound up"
   - **判斷標準**:如果中文意思需要用「或、另指」連接,或英文解釋需要用 "or" 分開兩個概念 → 就是不同意思,要分成兩筆
3. **英文解釋**:每筆 meaning 各自有一個簡短英文解釋
4. **3 個例句**:不同情境(日常 / 正式 / 文學等),附中文翻譯與情境
5. **語感(分四部分)**
   - **coreFeel**:核心語感、感覺、整體形象(一段話)
   - **synonymDifferences**:列出 2–4 個近義詞,逐一比較
   - **collocations**:列出 3–5 個常見搭配或慣用句型,每個附中文意思
   - **culturalContext**:文化背景、使用場合,沒有就填空字串
6. **詞形變化**:動詞三態、名詞複數、形容詞比較級等,無變化填「無」

請完整、實用,專注幫學習者掌握這個字的「感覺」。`;

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
