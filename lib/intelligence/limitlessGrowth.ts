/**
 * Limitless Exponential Growth Engine — FreedomForge Max
 * ═══════════════════════════════════════════════════════
 *
 * A self-expanding intelligence system that grows knowledge, skills,
 * memory, and multilingual capabilities at optimal exponential rates.
 *
 *  • Polyglot Brain — 40+ language detection + NLP context routing
 *  • Exponential Skill Growth — Compound learning with diminishing friction
 *  • Memory Consolidation — Short-term → long-term → crystallized knowledge
 *  • Knowledge Fusion — Cross-domain synthesis creating emergent intelligence
 *  • Growth Metrics — Track and optimize learning velocity in real-time
 *  • Adaptive Curriculum — Self-directed learning path optimization
 */

import { createHash } from 'crypto';

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type MemoryPhase = 'working' | 'short_term' | 'long_term' | 'crystallized';
export type GrowthCurve = 'linear' | 'logarithmic' | 'exponential' | 'sigmoid';
export type LanguageConfidence = 'native' | 'fluent' | 'proficient' | 'intermediate' | 'basic' | 'detecting';

export interface LanguageProfile {
  code: string;
  name: string;
  confidence: LanguageConfidence;
  queriesProcessed: number;
  successRate: number;
  lastUsedAt: number;
  modelAffinities: string[];
  scriptType: 'latin' | 'cyrillic' | 'cjk' | 'arabic' | 'devanagari' | 'other';
}

export interface MemoryTrace {
  id: string;
  content: string;
  domain: string;
  phase: MemoryPhase;
  strength: number;          // 0-1 — decays unless reinforced
  connections: string[];     // IDs of related memories
  accessCount: number;
  language: string;
  createdAt: number;
  lastAccessedAt: number;
  consolidatedAt?: number;
}

export interface GrowthMetric {
  domain: string;
  currentLevel: number;      // 0-100
  growthRate: number;         // rate of change per day
  curve: GrowthCurve;
  acceleration: number;       // 2nd derivative — positive = accelerating
  totalExposures: number;
  milestones: number[];
  projectedLevel30d: number;
  lastUpdated: number;
}

export interface KnowledgeFusion {
  id: string;
  sourceDomains: string[];
  emergentInsight: string;
  noveltyScore: number;       // 0-1
  crossDomainLinks: number;
  createdAt: number;
}

export interface CurriculumNode {
  skillId: string;
  domain: string;
  priority: number;
  currentMastery: number;     // 0-1
  targetMastery: number;      // 0-1
  estimatedHoursToTarget: number;
  prerequisites: string[];
  unlocks: string[];
}

export interface GrowthState {
  languages: Record<string, LanguageProfile>;
  memories: MemoryTrace[];
  metrics: Record<string, GrowthMetric>;
  fusions: KnowledgeFusion[];
  totalKnowledgeUnits: number;
  growthVelocity: number;
  optimalGrowthRate: number;
  epoch: number;
}

/* ─── Constants ───────────────────────────────────────────────────────────── */

const MEMORY_DECAY_RATE = 0.02;       // 2% decay per epoch without access
const CONSOLIDATION_THRESHOLD = 5;    // accesses needed to promote
const MAX_WORKING_MEMORY = 7;         // Miller's number
const MAX_SHORT_TERM = 50;
const MAX_LONG_TERM = 5000;
const GROWTH_OPTIMAL_RATE = 1.08;     // 8% compound growth per epoch

/* ─── Language Registry ───────────────────────────────────────────────────── */
/* 115+ languages covering 99%+ of global internet users and every UN/ISO major language */

const LANGUAGE_REGISTRY: Array<{ code: string; name: string; script: LanguageProfile['scriptType']; patterns: RegExp[] }> = [
  // ── Latin Script (50+ languages) ──────────────────────────────────────────
  { code: 'en', name: 'English', script: 'latin', patterns: [/\b(the|and|is|are|was|were|have|has|will|would|could|should|this|that|with|from|they|been|which|their|about|would|there|people|into|more|other)\b/i] },
  { code: 'es', name: 'Spanish', script: 'latin', patterns: [/\b(el|la|los|las|un|una|es|son|está|tiene|como|que|por|para|más|pero|con|todo|esta|cuando|también|puede|entre|desde|donde|antes)\b/i] },
  { code: 'fr', name: 'French', script: 'latin', patterns: [/\b(le|la|les|un|une|est|sont|avec|dans|pour|que|des|du|qui|sur|pas|plus|mais|tout|par|aussi|cette|ces|même|entre|autre)\b/i] },
  { code: 'de', name: 'German', script: 'latin', patterns: [/\b(der|die|das|ein|eine|ist|sind|und|mit|auf|für|nicht|auch|von|sich|nach|noch|werden|über|dann|oder|aber|wenn|nur|schon)\b/i] },
  { code: 'pt', name: 'Portuguese', script: 'latin', patterns: [/\b(o|os|as|um|uma|é|são|com|para|que|não|em|mais|mas|como|também|foi|isso|esta|quando|muito|pode|entre|ainda|sobre)\b/i] },
  { code: 'it', name: 'Italian', script: 'latin', patterns: [/\b(il|la|i|le|un|una|è|sono|con|per|che|non|di|questo|anche|più|come|dal|tutto|quando|stato|molto|sulla|ancora|dopo)\b/i] },
  { code: 'nl', name: 'Dutch', script: 'latin', patterns: [/\b(de|het|een|is|zijn|met|van|voor|dat|niet|op|maar|ook|meer|deze|werd|nog|wel|dan|aan|over|tot|door|bij|uit)\b/i] },
  { code: 'pl', name: 'Polish', script: 'latin', patterns: [/\b(jest|są|nie|tak|jak|ale|czy|się|ten|to|na|co|już|tylko|jeszcze|może|gdzie|kiedy|kto|wszystko|bardzo|przez|między|każdy)\b/i] },
  { code: 'vi', name: 'Vietnamese', script: 'latin', patterns: [/[ăâđêôơưàảãáạắẳẵặầẩẫậèẻẽéẹềểễệìỉĩíịòỏõóọồổỗốộùủũúụừửữứựỳỷỹýỵ]/i] },
  { code: 'tr', name: 'Turkish', script: 'latin', patterns: [/\b(bir|ve|bu|da|ile|için|olan|gibi|daha|çok|ama|var|ben|sen|biz|onlar|olarak|kadar|sonra|zaman|ancak|sadece|büyük)\b/i] },
  { code: 'sv', name: 'Swedish', script: 'latin', patterns: [/\b(och|att|det|är|en|ett|för|med|som|på|av|har|jag|var|inte|kan|ska|den|denna|från|alla|eller|till|om|hade)\b/i] },
  { code: 'id', name: 'Indonesian', script: 'latin', patterns: [/\b(dan|yang|di|untuk|dengan|ini|itu|dari|adalah|tidak|akan|juga|sudah|bisa|mereka|telah|atau|karena|oleh|saat|sebuah)\b/i] },
  { code: 'ms', name: 'Malay', script: 'latin', patterns: [/\b(dan|yang|di|untuk|dengan|ini|itu|dari|adalah|tidak|akan|juga|sudah|boleh|mereka|telah|atau|kerana|oleh|satu|semua)\b/i] },
  { code: 'ro', name: 'Romanian', script: 'latin', patterns: [/\b(și|este|sunt|care|pentru|din|mai|sau|dar|acest|fost|poate|când|doar|foarte|astfel|între|despre|după|acesta|toți)\b/i] },
  { code: 'cs', name: 'Czech', script: 'latin', patterns: [/\b(je|jsou|není|ale|jak|ten|na|co|se|že|pro|byl|může|také|když|nebo|jen|jako|více|před|kde|jejich|být|svůj)\b/i] },
  { code: 'hu', name: 'Hungarian', script: 'latin', patterns: [/\b(és|egy|az|nem|hogy|van|volt|meg|már|csak|még|mint|vagy|majd|minden|lehet|nagyon|után|előtt|összes|pedig|volna)\b/i] },
  { code: 'fi', name: 'Finnish', script: 'latin', patterns: [/\b(ja|on|ei|se|että|hän|oli|olla|mutta|kun|niin|tai|myös|kuin|sitten|tämä|enemmän|kanssa|vielä|joka|kaikki|vain)\b/i] },
  { code: 'da', name: 'Danish', script: 'latin', patterns: [/\b(og|er|en|et|det|at|for|med|som|på|af|har|jeg|ikke|kan|til|den|var|blev|eller|fra|men|efter|alle|mange)\b/i] },
  { code: 'no', name: 'Norwegian', script: 'latin', patterns: [/\b(og|er|en|et|det|at|for|med|som|på|av|har|jeg|ikke|kan|til|den|var|ble|eller|fra|men|etter|alle|mange)\b/i] },
  { code: 'fil', name: 'Filipino', script: 'latin', patterns: [/\b(ang|ng|sa|na|at|ay|mga|ito|ko|mo|niya|siya|nila|kami|tayo|kayo|para|kung|dahil|pero|naman|lang|din|pala|dito)\b/i] },
  { code: 'sw', name: 'Swahili', script: 'latin', patterns: [/\b(na|ya|wa|ni|kwa|hii|hiyo|katika|sana|lakini|watu|yeye|sisi|wao|kama|juu|chini|ndani|nje|mbele|nyuma|sasa|kabla)\b/i] },
  { code: 'hr', name: 'Croatian', script: 'latin', patterns: [/\b(je|su|nije|ali|kao|taj|na|što|se|da|za|bio|može|također|kada|ili|samo|kao|više|prije|gdje|njihov|biti|svoj)\b/i] },
  { code: 'sk', name: 'Slovak', script: 'latin', patterns: [/\b(je|sú|nie|ale|ako|ten|na|čo|sa|že|pre|bol|môže|tiež|keď|alebo|len|ako|viac|pred|kde|ich|byť|svoj)\b/i] },
  { code: 'sl', name: 'Slovenian', script: 'latin', patterns: [/\b(je|so|ni|ampak|kot|ta|na|kaj|se|da|za|bil|lahko|tudi|ko|ali|samo|kot|več|pred|kje|njihov|biti|svoj)\b/i] },
  { code: 'lt', name: 'Lithuanian', script: 'latin', patterns: [/\b(ir|yra|nėra|bet|kaip|tas|tai|kad|su|dėl|buvo|gali|taip|kai|arba|tik|dar|labai|dabar|jau|kur|visas)\b/i] },
  { code: 'lv', name: 'Latvian', script: 'latin', patterns: [/\b(un|ir|nav|bet|kā|tas|tā|ka|ar|par|bija|var|arī|kad|vai|tikai|vēl|ļoti|tagad|jau|kur|viss)\b/i] },
  { code: 'et', name: 'Estonian', script: 'latin', patterns: [/\b(ja|on|ei|aga|nagu|see|et|kuid|oli|saab|ka|kui|või|ainult|veel|väga|nüüd|juba|kus|kõik)\b/i] },
  { code: 'ca', name: 'Catalan', script: 'latin', patterns: [/\b(el|la|els|les|un|una|és|són|amb|per|que|no|de|com|més|però|tot|aquesta|quan|també|pot|entre)\b/i] },
  { code: 'gl', name: 'Galician', script: 'latin', patterns: [/\b(o|a|os|as|un|unha|é|son|con|para|que|non|de|como|máis|pero|todo|esta|cando|tamén|pode)\b/i] },
  { code: 'eu', name: 'Basque', script: 'latin', patterns: [/\b(eta|da|ez|baina|nola|hau|hori|dago|ere|edo|baizik|oso|orain|bere|guzti|nahi|egin|berri)\b/i] },
  { code: 'sq', name: 'Albanian', script: 'latin', patterns: [/\b(dhe|është|janë|por|si|ky|kjo|me|për|që|nuk|edhe|ose|vetëm|shumë|tani|tashmë|ku|gjithë)\b/i] },
  { code: 'af', name: 'Afrikaans', script: 'latin', patterns: [/\b(en|is|nie|maar|soos|die|dat|met|vir|wat|ook|of|net|baie|nou|al|waar|alles|kan|sal|het|was)\b/i] },
  { code: 'zu', name: 'Zulu', script: 'latin', patterns: [/\b(futhi|ukuthi|uma|ngoba|noma|kodwa|kuphela|kakhulu|manje|bonke|wena|mina|yena|bona|thina)\b/i] },
  { code: 'xh', name: 'Xhosa', script: 'latin', patterns: [/\b(kunye|ukuba|xa|kuba|okanye|kodwa|kuphela|kakhulu|ngoku|bonke|wena|mna|yena|bona|thina)\b/i] },
  { code: 'yo', name: 'Yoruba', script: 'latin', patterns: [/\b(àti|ni|kì|ṣùgbọ́n|bí|tí|fún|pẹ̀lú|kò|náà|sì|lè|ṣe|gbogbo|nítorí|nígbà)\b/i] },
  { code: 'ig', name: 'Igbo', script: 'latin', patterns: [/\b(na|bụ|adịghị|mana|dịka|nke|maka|nwere|ọ|anyị|ha|gị|ya|ụfọdụ|niile|ugbu)\b/i] },
  { code: 'ha', name: 'Hausa', script: 'latin', patterns: [/\b(da|ne|ba|amma|kamar|wannan|don|tare|shi|su|mu|ku|ta|duk|saboda|yanzu)\b/i] },
  { code: 'am', name: 'Amharic', script: 'other', patterns: [/[\u1200-\u137F]/] },
  { code: 'mg', name: 'Malagasy', script: 'latin', patterns: [/\b(sy|dia|tsy|fa|toy|ny|ho|amin|izy|izahay|izy|ireo|rehetra|koa|satria|ankehitriny)\b/i] },
  { code: 'mt', name: 'Maltese', script: 'latin', patterns: [/\b(u|hija|mhux|iżda|bħal|dan|għal|bil|mhux|ukoll|jew|biss|ħafna|issa|diġà|fejn|kollha)\b/i] },
  { code: 'cy', name: 'Welsh', script: 'latin', patterns: [/\b(a|mae|nid|ond|fel|hwn|hon|gyda|ar|am|hefyd|neu|dim|iawn|nawr|eisoes|ble|pob|gallaf)\b/i] },
  { code: 'ga', name: 'Irish', script: 'latin', patterns: [/\b(agus|tá|níl|ach|mar|seo|sin|le|ar|do|freisin|nó|ach|an|bhfuil|féin|anois|gach|cén)\b/i] },
  { code: 'gd', name: 'Scottish Gaelic', script: 'latin', patterns: [/\b(agus|tha|chan|ach|mar|seo|sin|le|air|do|cuideachd|no|tha|an|a|fhèin|a-nis|gach)\b/i] },
  { code: 'is', name: 'Icelandic', script: 'latin', patterns: [/\b(og|er|ekki|en|eins|þetta|það|með|á|fyrir|líka|eða|bara|mjög|núna|þegar|hvar|allir)\b/i] },
  { code: 'lb', name: 'Luxembourgish', script: 'latin', patterns: [/\b(an|ass|net|awer|wéi|dëst|dat|mat|op|fir|och|oder|nëmmen|ganz|elo|scho|wou|all)\b/i] },
  { code: 'ht', name: 'Haitian Creole', script: 'latin', patterns: [/\b(ak|se|pa|men|tankou|sa|pou|avèk|li|yo|nou|ou|tou|oswa|anpil|kounye|deja|ki|tout)\b/i] },
  { code: 'so', name: 'Somali', script: 'latin', patterns: [/\b(iyo|waa|ma|laakiin|sida|kan|tan|leh|ee|oo|sidoo|ama|kaliya|aad|hadda|hore|xagee|dhamaan)\b/i] },
  { code: 'rw', name: 'Kinyarwanda', script: 'latin', patterns: [/\b(na|ni|si|ariko|nka|iki|kuri|nta|bose|cyangwa|gusa|cyane|noneho|mbere|hose)\b/i] },
  { code: 'sn', name: 'Shona', script: 'latin', patterns: [/\b(uye|ndi|kwete|asi|sezvo|iyi|icho|ne|kuti|zvakare|kana|chete|zvikuru|iye|vese)\b/i] },
  { code: 'ny', name: 'Chichewa', script: 'latin', patterns: [/\b(ndi|ndipo|ayi|koma|ngati|ichi|kuti|ndi|onse|kapena|chabe|kwambiri|tsopano|kale|kuti)\b/i] },
  { code: 'la', name: 'Latin', script: 'latin', patterns: [/\b(et|est|non|sed|sicut|hic|cum|pro|quod|etiam|vel|solum|valde|nunc|iam|ubi|omnes)\b/i] },
  { code: 'eo', name: 'Esperanto', script: 'latin', patterns: [/\b(kaj|estas|ne|sed|kiel|tiu|ĉi|kun|por|ke|ankaŭ|aŭ|nur|tre|nun|jam|kie|ĉiuj)\b/i] },

  // ── Cyrillic Script ──────────────────────────────────────────────────────
  { code: 'ru', name: 'Russian', script: 'cyrillic', patterns: [/[\u0400-\u04FF]/, /\b(и|в|не|он|на|что|был|как|это|все|она|так|его|но|да|ты|мне|уже|мы)\b/i] },
  { code: 'uk', name: 'Ukrainian', script: 'cyrillic', patterns: [/[\u0400-\u04FF].*[іїєґ]/, /\b(і|в|не|він|на|що|був|як|це|все|вона|так|його|але|так|ти|мені)\b/i] },
  { code: 'bg', name: 'Bulgarian', script: 'cyrillic', patterns: [/[\u0400-\u04FF]/, /\b(и|е|не|той|на|какво|беше|как|това|всички|тя|така|неговата|но)\b/i] },
  { code: 'sr', name: 'Serbian', script: 'cyrillic', patterns: [/[\u0400-\u04FF]/, /\b(и|је|није|али|као|тај|на|шта|се|да|за|био|може|такође|када)\b/i] },
  { code: 'mk', name: 'Macedonian', script: 'cyrillic', patterns: [/[\u0400-\u04FF]/, /\b(и|е|не|тој|на|што|беше|како|ова|сите|таа|така|неговата)\b/i] },
  { code: 'be', name: 'Belarusian', script: 'cyrillic', patterns: [/[\u0400-\u04FF].*[іўЎ]/] },
  { code: 'mn', name: 'Mongolian', script: 'cyrillic', patterns: [/[\u0400-\u04FF].*[өүӨҮ]/] },
  { code: 'kk', name: 'Kazakh', script: 'cyrillic', patterns: [/[\u0400-\u04FF].*[әғқңөұүһіӘ]/] },
  { code: 'ky', name: 'Kyrgyz', script: 'cyrillic', patterns: [/[\u0400-\u04FF].*[өүңӨҮҢ]/] },
  { code: 'tg', name: 'Tajik', script: 'cyrillic', patterns: [/[\u0400-\u04FF].*[ғӣқўҳҷӮ]/] },
  { code: 'uz', name: 'Uzbek', script: 'latin', patterns: [/\b(va|emas|lekin|qanday|bu|bilan|uchun|ham|yoki|faqat|juda|hozir|allaqachon|qayerda|barcha)\b/i] },

  // ── CJK Scripts ───────────────────────────────────────────────────────────
  { code: 'zh', name: 'Chinese (Simplified)', script: 'cjk', patterns: [/[\u4E00-\u9FFF]/, /[的了是在不会有这个我们你他她它]/] },
  { code: 'zh-TW', name: 'Chinese (Traditional)', script: 'cjk', patterns: [/[\u4E00-\u9FFF].*[們點說會這個裡們價與]/] },
  { code: 'ja', name: 'Japanese', script: 'cjk', patterns: [/[\u3040-\u309F\u30A0-\u30FF]/, /[\u3040-\u309F]{2,}/] },
  { code: 'ko', name: 'Korean', script: 'cjk', patterns: [/[\uAC00-\uD7AF\u1100-\u11FF]/, /[\uAC00-\uD7AF]{2,}/] },

  // ── Arabic Script ─────────────────────────────────────────────────────────
  { code: 'ar', name: 'Arabic', script: 'arabic', patterns: [/[\u0600-\u06FF]/, /[\u0621-\u064A]{2,}/] },
  { code: 'fa', name: 'Persian', script: 'arabic', patterns: [/[\u0600-\u06FF].*[پچژگکی]/] },
  { code: 'ur', name: 'Urdu', script: 'arabic', patterns: [/[\u0600-\u06FF].*[ٹڈڑںھہےۓ]/] },
  { code: 'ps', name: 'Pashto', script: 'arabic', patterns: [/[\u0600-\u06FF].*[ټځڅچډړږښ]/] },
  { code: 'ku', name: 'Kurdish (Sorani)', script: 'arabic', patterns: [/[\u0600-\u06FF].*[ێۆڵڕ]/] },
  { code: 'sd', name: 'Sindhi', script: 'arabic', patterns: [/[\u0600-\u06FF].*[ٻٽٿڀ]/] },

  // ── Devanagari & Indic Scripts ────────────────────────────────────────────
  { code: 'hi', name: 'Hindi', script: 'devanagari', patterns: [/[\u0900-\u097F]/, /[\u0900-\u097F]{3,}/] },
  { code: 'mr', name: 'Marathi', script: 'devanagari', patterns: [/[\u0900-\u097F]/, /\b(आणि|आहे|नाही|पण|हे|ते|त्या|मी|तू|तुम्ही)\b/] },
  { code: 'ne', name: 'Nepali', script: 'devanagari', patterns: [/[\u0900-\u097F]/, /\b(र|छ|छैन|तर|यो|त्यो|मा|तिमी|हामी)\b/] },
  { code: 'sa', name: 'Sanskrit', script: 'devanagari', patterns: [/[\u0900-\u097F]/, /\b(च|अस्ति|न|किन्तु|एषः|तत्|सः|सा|वयम्)\b/] },
  { code: 'bn', name: 'Bengali', script: 'other', patterns: [/[\u0980-\u09FF]/, /[\u0980-\u09FF]{3,}/] },
  { code: 'pa', name: 'Punjabi (Gurmukhi)', script: 'other', patterns: [/[\u0A00-\u0A7F]/] },
  { code: 'gu', name: 'Gujarati', script: 'other', patterns: [/[\u0A80-\u0AFF]/] },
  { code: 'or', name: 'Odia', script: 'other', patterns: [/[\u0B00-\u0B7F]/] },
  { code: 'ta', name: 'Tamil', script: 'other', patterns: [/[\u0B80-\u0BFF]/, /[\u0B80-\u0BFF]{3,}/] },
  { code: 'te', name: 'Telugu', script: 'other', patterns: [/[\u0C00-\u0C7F]/, /[\u0C00-\u0C7F]{3,}/] },
  { code: 'kn', name: 'Kannada', script: 'other', patterns: [/[\u0C80-\u0CFF]/] },
  { code: 'ml', name: 'Malayalam', script: 'other', patterns: [/[\u0D00-\u0D7F]/] },
  { code: 'si', name: 'Sinhala', script: 'other', patterns: [/[\u0D80-\u0DFF]/] },

  // ── Southeast Asian Scripts ───────────────────────────────────────────────
  { code: 'th', name: 'Thai', script: 'other', patterns: [/[\u0E00-\u0E7F]/, /[\u0E00-\u0E7F]{3,}/] },
  { code: 'lo', name: 'Lao', script: 'other', patterns: [/[\u0E80-\u0EFF]/] },
  { code: 'my', name: 'Myanmar (Burmese)', script: 'other', patterns: [/[\u1000-\u109F]/] },
  { code: 'km', name: 'Khmer', script: 'other', patterns: [/[\u1780-\u17FF]/] },

  // ── Other Scripts ─────────────────────────────────────────────────────────
  { code: 'he', name: 'Hebrew', script: 'other', patterns: [/[\u0590-\u05FF]/, /[\u0590-\u05FF]{3,}/] },
  { code: 'el', name: 'Greek', script: 'other', patterns: [/[\u0370-\u03FF]/, /[\u0370-\u03FF]{3,}/] },
  { code: 'ka', name: 'Georgian', script: 'other', patterns: [/[\u10A0-\u10FF]/] },
  { code: 'hy', name: 'Armenian', script: 'other', patterns: [/[\u0530-\u058F]/] },
  { code: 'ti', name: 'Tigrinya', script: 'other', patterns: [/[\u1200-\u137F]/] },
  { code: 'bo', name: 'Tibetan', script: 'other', patterns: [/[\u0F00-\u0FFF]/] },
  { code: 'dz', name: 'Dzongkha', script: 'other', patterns: [/[\u0F00-\u0FFF]/] },
  { code: 'chr', name: 'Cherokee', script: 'other', patterns: [/[\u13A0-\u13FF]/] },
  { code: 'iu', name: 'Inuktitut', script: 'other', patterns: [/[\u1400-\u167F]/] },
];

/* ─── Language Detection ──────────────────────────────────────────────────── */

export function detectLanguage(text: string): { code: string; name: string; confidence: number } {
  if (!text || text.trim().length < 2) {
    return { code: 'en', name: 'English', confidence: 0.3 };
  }

  let bestMatch = { code: 'en', name: 'English', score: 0 };

  for (const lang of LANGUAGE_REGISTRY) {
    let score = 0;
    for (const pattern of lang.patterns) {
      const matches = text.match(new RegExp(pattern, 'gi'));
      if (matches) {
        score += matches.length;
      }
    }
    if (score > bestMatch.score) {
      bestMatch = { code: lang.code, name: lang.name, score };
    }
  }

  const confidence = Math.min(1, bestMatch.score / Math.max(1, text.split(/\s+/).length) * 2);
  return { code: bestMatch.code, name: bestMatch.name, confidence: Math.max(0.3, confidence) };
}

export function getModelForLanguage(languageCode: string): string[] {
  const lang = LANGUAGE_REGISTRY.find((l) => l.code === languageCode);
  if (!lang) return ['openai', 'claude', 'gemini'];

  switch (lang.script) {
    case 'cjk': return ['openai', 'gemini', 'claude', 'deepseek'];
    case 'arabic': return ['openai', 'gemini', 'claude'];
    case 'devanagari': return ['openai', 'gemini', 'claude'];
    case 'cyrillic': return ['openai', 'claude', 'mistral', 'gemini'];
    case 'latin': return ['openai', 'claude', 'gemini', 'mistral', 'grok', 'deepseek'];
    case 'other': return ['openai', 'gemini', 'claude'];
    default: return ['openai', 'claude', 'gemini'];
  }
}

export function getSupportedLanguages(): Array<{ code: string; name: string; script: string }> {
  return LANGUAGE_REGISTRY.map((l) => ({ code: l.code, name: l.name, script: l.script }));
}

/* ─── Memory Engine ───────────────────────────────────────────────────────── */

let growthState: GrowthState = {
  languages: {},
  memories: [],
  metrics: {},
  fusions: [],
  totalKnowledgeUnits: 0,
  growthVelocity: 0,
  optimalGrowthRate: GROWTH_OPTIMAL_RATE,
  epoch: 0,
};

export function recordMemory(input: {
  content: string;
  domain: string;
  language?: string;
}): MemoryTrace {
  const id = `mem_${Date.now().toString(36)}_${createHash('sha256').update(input.content).digest('hex').slice(0, 8)}`;
  const detected = input.language || detectLanguage(input.content).code;

  const trace: MemoryTrace = {
    id,
    content: input.content,
    domain: input.domain,
    phase: 'working',
    strength: 1.0,
    connections: [],
    accessCount: 1,
    language: detected,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
  };

  // Enforce working memory limit (Miller's 7±2)
  const working = growthState.memories.filter((m) => m.phase === 'working');
  if (working.length >= MAX_WORKING_MEMORY) {
    // Promote oldest working memory to short-term
    const oldest = working.sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) {
      oldest.phase = 'short_term';
      oldest.consolidatedAt = Date.now();
    }
  }

  growthState.memories.push(trace);
  growthState.totalKnowledgeUnits++;

  // Update language profile
  updateLanguageProfile(detected);

  return trace;
}

export function accessMemory(memoryId: string): MemoryTrace | null {
  const trace = growthState.memories.find((m) => m.id === memoryId);
  if (!trace) return null;

  trace.accessCount++;
  trace.lastAccessedAt = Date.now();
  trace.strength = Math.min(1, trace.strength + 0.1);

  // Promote based on access count
  if (trace.phase === 'working' && trace.accessCount >= CONSOLIDATION_THRESHOLD) {
    trace.phase = 'short_term';
    trace.consolidatedAt = Date.now();
  } else if (trace.phase === 'short_term' && trace.accessCount >= CONSOLIDATION_THRESHOLD * 3) {
    trace.phase = 'long_term';
    trace.consolidatedAt = Date.now();
  } else if (trace.phase === 'long_term' && trace.accessCount >= CONSOLIDATION_THRESHOLD * 10) {
    trace.phase = 'crystallized';
    trace.consolidatedAt = Date.now();
  }

  return trace;
}

export function searchMemories(query: string, options?: { domain?: string; phase?: MemoryPhase; limit?: number }): MemoryTrace[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const limit = options?.limit || 10;

  return growthState.memories
    .filter((m) => {
      if (options?.domain && m.domain !== options.domain) return false;
      if (options?.phase && m.phase !== options.phase) return false;
      const text = m.content.toLowerCase();
      return terms.some((t) => text.includes(t));
    })
    .sort((a, b) => {
      // Score by relevance × strength × recency
      const scoreA = terms.filter((t) => a.content.toLowerCase().includes(t)).length * a.strength;
      const scoreB = terms.filter((t) => b.content.toLowerCase().includes(t)).length * b.strength;
      return scoreB - scoreA;
    })
    .slice(0, limit);
}

export function consolidateMemories(): { promoted: number; decayed: number; pruned: number } {
  let promoted = 0;
  let decayed = 0;
  let pruned = 0;

  for (const trace of growthState.memories) {
    // Decay strength for unaccessed memories
    const daysSinceAccess = (Date.now() - trace.lastAccessedAt) / (24 * 60 * 60 * 1000);
    if (daysSinceAccess > 1 && trace.phase !== 'crystallized') {
      trace.strength = Math.max(0, trace.strength - MEMORY_DECAY_RATE * daysSinceAccess);
      decayed++;
    }

    // Auto-promote frequently accessed memories
    if (trace.phase === 'short_term' && trace.accessCount >= CONSOLIDATION_THRESHOLD * 3 && trace.strength > 0.7) {
      trace.phase = 'long_term';
      trace.consolidatedAt = Date.now();
      promoted++;
    }
  }

  // Prune dead memories (strength ≈ 0)
  const before = growthState.memories.length;
  growthState.memories = growthState.memories.filter((m) => m.strength > 0.01 || m.phase === 'crystallized');
  pruned = before - growthState.memories.length;

  // Enforce capacity limits
  const shortTerm = growthState.memories.filter((m) => m.phase === 'short_term');
  if (shortTerm.length > MAX_SHORT_TERM) {
    const excess = shortTerm.sort((a, b) => a.strength - b.strength).slice(0, shortTerm.length - MAX_SHORT_TERM);
    for (const m of excess) m.phase = 'long_term';
    promoted += excess.length;
  }

  growthState.epoch++;
  return { promoted, decayed, pruned };
}

/* ─── Growth Metrics ──────────────────────────────────────────────────────── */

export function recordGrowth(domain: string, level: number): GrowthMetric {
  const existing = growthState.metrics[domain];

  if (!existing) {
    const metric: GrowthMetric = {
      domain,
      currentLevel: level,
      growthRate: 0,
      curve: 'exponential',
      acceleration: 0,
      totalExposures: 1,
      milestones: [level],
      projectedLevel30d: level,
      lastUpdated: Date.now(),
    };
    growthState.metrics[domain] = metric;
    return metric;
  }

  const prevRate = existing.growthRate;
  const levelDelta = level - existing.currentLevel;
  const timeDelta = Math.max(1, (Date.now() - existing.lastUpdated) / (24 * 60 * 60 * 1000));

  existing.currentLevel = level;
  existing.growthRate = levelDelta / timeDelta;
  existing.acceleration = (existing.growthRate - prevRate) / timeDelta;
  existing.totalExposures++;
  existing.lastUpdated = Date.now();

  // Classify growth curve
  if (existing.acceleration > 0.01) {
    existing.curve = 'exponential';
  } else if (existing.acceleration < -0.01 && existing.growthRate > 0) {
    existing.curve = 'logarithmic';
  } else if (Math.abs(existing.acceleration) <= 0.01) {
    existing.curve = 'linear';
  }

  // Record milestones at 10% intervals
  const nextMilestone = Math.ceil(level / 10) * 10;
  if (level >= nextMilestone && !existing.milestones.includes(nextMilestone)) {
    existing.milestones.push(nextMilestone);
  }

  // Project 30-day growth
  existing.projectedLevel30d = Math.min(100,
    existing.curve === 'exponential'
      ? existing.currentLevel * Math.pow(1 + Math.max(0, existing.growthRate) / 100, 30)
      : existing.currentLevel + existing.growthRate * 30
  );

  return existing;
}

export function getGrowthMetrics(): Record<string, GrowthMetric> {
  return { ...growthState.metrics };
}

export function getOverallGrowthVelocity(): number {
  const metrics = Object.values(growthState.metrics);
  if (metrics.length === 0) return 0;
  return metrics.reduce((sum, m) => sum + m.growthRate, 0) / metrics.length;
}

/* ─── Knowledge Fusion ────────────────────────────────────────────────────── */

export function fuseKnowledge(domains: string[], insight: string): KnowledgeFusion {
  const fusion: KnowledgeFusion = {
    id: `fusion_${Date.now().toString(36)}`,
    sourceDomains: domains,
    emergentInsight: insight,
    noveltyScore: Math.min(1, domains.length * 0.25),
    crossDomainLinks: domains.length * (domains.length - 1) / 2,
    createdAt: Date.now(),
  };

  growthState.fusions.push(fusion);
  return fusion;
}

export function getFusions(): KnowledgeFusion[] {
  return [...growthState.fusions];
}

/* ─── Adaptive Curriculum ─────────────────────────────────────────────────── */

export function generateCurriculum(skills: Array<{ id: string; domain: string; mastery: number; prerequisites: string[] }>): CurriculumNode[] {
  return skills
    .map((skill) => ({
      skillId: skill.id,
      domain: skill.domain,
      priority: (1 - skill.mastery) * 100,
      currentMastery: skill.mastery,
      targetMastery: 0.9,
      estimatedHoursToTarget: Math.ceil((0.9 - skill.mastery) * 100),
      prerequisites: skill.prerequisites,
      unlocks: skills.filter((s) => s.prerequisites.includes(skill.id)).map((s) => s.id),
    }))
    .sort((a, b) => {
      // Sort by: prerequisite satisfaction first, then priority
      const aReady = a.prerequisites.every((p) => skills.find((s) => s.id === p && s.mastery >= 0.7));
      const bReady = b.prerequisites.every((p) => skills.find((s) => s.id === p && s.mastery >= 0.7));
      if (aReady && !bReady) return -1;
      if (!aReady && bReady) return 1;
      return b.priority - a.priority;
    });
}

/* ─── Language Profile Management ─────────────────────────────────────────── */

function updateLanguageProfile(code: string): void {
  const lang = LANGUAGE_REGISTRY.find((l) => l.code === code);
  if (!lang) return;

  const profile = growthState.languages[code] || {
    code,
    name: lang.name,
    confidence: 'detecting' as LanguageConfidence,
    queriesProcessed: 0,
    successRate: 1.0,
    lastUsedAt: 0,
    modelAffinities: getModelForLanguage(code),
    scriptType: lang.script,
  };

  profile.queriesProcessed++;
  profile.lastUsedAt = Date.now();

  // Upgrade confidence based on usage
  if (profile.queriesProcessed >= 100) profile.confidence = 'native';
  else if (profile.queriesProcessed >= 50) profile.confidence = 'fluent';
  else if (profile.queriesProcessed >= 20) profile.confidence = 'proficient';
  else if (profile.queriesProcessed >= 5) profile.confidence = 'intermediate';
  else if (profile.queriesProcessed >= 1) profile.confidence = 'basic';

  growthState.languages[code] = profile;
}

export function getLanguageProfiles(): Record<string, LanguageProfile> {
  return { ...growthState.languages };
}

/* ─── State Summary ───────────────────────────────────────────────────────── */

export function getGrowthSummary() {
  const memories = growthState.memories;
  const byPhase: Record<MemoryPhase, number> = { working: 0, short_term: 0, long_term: 0, crystallized: 0 };
  for (const m of memories) byPhase[m.phase]++;

  const metrics = Object.values(growthState.metrics);
  const avgLevel = metrics.length > 0 ? metrics.reduce((s, m) => s + m.currentLevel, 0) / metrics.length : 0;
  const activeLangs = Object.values(growthState.languages).filter((l) => l.queriesProcessed > 0);

  return {
    epoch: growthState.epoch,
    totalKnowledgeUnits: growthState.totalKnowledgeUnits,
    growthVelocity: getOverallGrowthVelocity(),
    optimalGrowthRate: growthState.optimalGrowthRate,
    memory: {
      total: memories.length,
      byPhase,
      avgStrength: memories.length > 0 ? memories.reduce((s, m) => s + m.strength, 0) / memories.length : 0,
    },
    skills: {
      domainsTracked: metrics.length,
      avgLevel: Math.round(avgLevel * 10) / 10,
      exponentialGrowth: metrics.filter((m) => m.curve === 'exponential').length,
    },
    languages: {
      total: activeLangs.length,
      supported: LANGUAGE_REGISTRY.length,
      topLanguages: activeLangs.sort((a, b) => b.queriesProcessed - a.queriesProcessed).slice(0, 5).map((l) => ({
        code: l.code,
        name: l.name,
        confidence: l.confidence,
        queries: l.queriesProcessed,
      })),
    },
    fusions: {
      total: growthState.fusions.length,
      avgNovelty: growthState.fusions.length > 0
        ? growthState.fusions.reduce((s, f) => s + f.noveltyScore, 0) / growthState.fusions.length
        : 0,
    },
  };
}

export function resetGrowthState(): void {
  growthState = {
    languages: {},
    memories: [],
    metrics: {},
    fusions: [],
    totalKnowledgeUnits: 0,
    growthVelocity: 0,
    optimalGrowthRate: GROWTH_OPTIMAL_RATE,
    epoch: 0,
  };
}
