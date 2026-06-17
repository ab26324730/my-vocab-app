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
      description: "依詞性分類。每個詞性一筆 entry,內含 senses 陣列。",
      items: {
        type: "object",
        properties: {
          partOfSpeech: { type: "string", description: "詞性(動詞、名詞、形容詞等)" },
          senses: {
            type: "array",
            description: "這個詞性的所有獨立意思。**1 個 sense = 1 個元素**。如果單字無歧義只放 1 個元素;有多個截然不同的意思就放多個元素。",
            items: {
              type: "object",
              properties: {
                chineseTranslation: {
                  type: "string",
                  description: "這個 sense 的中文意思。**型別是字串(不是陣列)**。**用「、」頓號連接所有同義詞於一個字串中**。例如 'unwind 放鬆' 這個 sense 寫成 '放鬆、紓壓、休息',「解開」這個 sense 寫成 '解開、卷開、展開'。一個字串內所有詞必須是同義詞或近義字,不可混入其他意思。"
                },
                englishDefinition: {
                  type: "string",
                  description: "這個 sense 的英文簡短解釋,只解釋這一個 sense"
                }
              },
              required: ["chineseTranslation", "englishDefinition"],
              additionalProperties: false
            }
          }
        },
        required: ["partOfSpeech", "senses"],
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

══════════════════════════════════════════
🚨 meanings 結構說明(嚴格遵守)
══════════════════════════════════════════

每個詞性一筆 entry,entry 內有 senses 陣列。

**senses 陣列:每個元素代表「一個獨立的意思 (distinct sense)」。**
- 單字無歧義 → senses 放 1 個元素
- 單字有 N 個截然不同的意思 → senses 放 N 個元素

**每個 sense 內:**
- \`chineseTranslation\`:**字串**(不是陣列!)。用頓號「、」連接這個 sense 的所有同義詞。
- \`englishDefinition\`:這個 sense 的英文解釋。

✅ 正確示範 — unwind 動詞有 3 個獨立意思:
{
  partOfSpeech: "動詞",
  senses: [
    {
      chineseTranslation: "放鬆、紓壓、休息",
      englishDefinition: "to relax and let go of stress"
    },
    {
      chineseTranslation: "解開、卷開、展開",
      englishDefinition: "to unfold something wound up"
    },
    {
      chineseTranslation: "逐漸揭露、逐步展開",
      englishDefinition: "to gradually reveal (figurative)"
    }
  ]
}

注意 chineseTranslation 是「字串」(一個字串包多個同義詞),不是「字串陣列」。

❌ 錯誤示範 — 不要這樣寫:
- chineseTranslation: ["放鬆", "紓壓"]  ← 錯,是字串不是陣列
- chineseTranslation: "放鬆"  / senses 6 個元素  ← 錯,同義詞應該連在同一字串裡
- senses 只放 1 個元素 chineseTranslation: "放鬆、解開"  ← 錯,不同意思不能放同字串

══════════════════════════════════════════

**0. typoCheck — 拼字偵測**
- 仔細看使用者輸入的拼字。若疑似拼錯,設 isLikelyTypo: true,並在 suggestedSpelling 給正確拼法。
- confidence:"high" / "medium" / "low" / "none"
- 若懷疑是錯字(high/medium),請以「正確拼法」回答後續所有欄位
- reason 簡短說明判斷理由

請以 ${settings.nativeLanguage} 為母語的學習者為對象,提供:

1. **發音(pronunciation)**:IPA 音標(日文給羅馬拼音+假名,韓文給羅馬拼音)
2. **meanings**:依上方規則,每個 distinct sense 各一筆 entry
3. **3 個例句(examples)**:不同情境(日常 / 正式 / 文學等),附中文翻譯與情境
4. **語感(nuance,分四部分)**
   - **coreFeel**:核心語感、感覺、整體形象(一段話)
   - **synonymDifferences**:列出 2–4 個近義詞,逐一比較
   - **collocations**:列出 3–5 個常見搭配或慣用句型,每個附中文意思
   - **culturalContext**:文化背景、使用場合,沒有就填空字串
5. **詞形變化(wordForms)**:動詞三態、名詞複數、形容詞比較級等,無變化填「無」

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
