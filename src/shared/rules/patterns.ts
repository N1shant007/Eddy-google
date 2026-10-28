/* Phrase patterns used by the storytelling rules (English, Hinglish and Devanagari). Ported from Eddy v1. */

export const GUEST_RE = /\b(today we have|aaj (humare|hamare) (paas|saath)|with us today|welcome|humare saath|hamare saath|aaj .{0,30}saath|joining us|join us|our guest|special guest|swagat)\b/i;
export const BRAND_RE = /\b(bajaj|finserv|housing finance|our app|the app|apply now|download|visit|website|offer|explore kar|check kijiye|check karein)\b/i;
export const PRODUCT_RE = /\b(home loan|personal loan|gold loan|business loan|loan against property|insurance|credit card|fixed deposit|emi card|car loan|two[- ]wheeler loan)s?\b/i;
export const VALUE_RE = /(requirement|employment|income|liabilit|credit|profile|verif|approv|lender|criteria|timeline|assess|ownership|repayment|\bsteps?\b|process|eligib|documents?\b|apply|application|interest|\bemi\b|tenure|rate|tax|holding period|calculat|depends? on|generally|important|zaroori|remember|yaad rakh|\btips?\b|benefit|sav(e|ing)|bachat|plan(ning)?\b|budget|down ?payment|loan|insurance|\d)/i;
export const CTA_RE = /(visit|check (out|your|the|it)|website|\bapp\b|apply (now|today|online)|download|emi calculator|start planning|explore|click|\blink\b|today itself|aaj hi)/i;
export const ACK_RE = /\b(understood|i understand|now i('| a)?m clear|i('| a)?m clear now|clear now|got it|makes sense|samajh (gaya|gayi|aa gaya)|i will (follow|try|do|start|keep|calculate|explore|use|apply|check)|i('ll| will) (follow|try)|(main|hum) .{0,40}(karunga|karungi|karenge))\b/i;
export const SAVINGS_RE = /(saving|\bsave[sd]?\b|bachat|bach(a|e|ega|egi|ate)\b|paise\s+bach|kam\s+(emi|tax|interest|byaj)|lower\s+(emi|tax|interest|rate)|less\s+tax|tax\s+(benefit|saving|deduction|rebate|exemption|bach)|80c|section\s+24|deduction|rebate|cashback|discount|affordab|comfortabl|financial\s+goals|emergency\s+(fund|savings)|wealth|returns?\s+(achha|good|better))/i;
export const INSIGHT_RE = /(\bsteps?\b|holding period|generally|depends? on|calculat|eligibility|documents?\b|\btips?\b|important|zaroori|yaad\s+rakh|remember|key\s+(point|thing)|factors?\b|criteria|consider\s+kar|check\s+(karn|kijiye|karein)|kijiye\b.*\b(samajh|check|assess)|isliye|matlab|which\s+means|the\s+process|assess\s+kijiye|pehla\s+step|first\s+step)/i;
export const INSIGHT_MOOD = /inform|guid|explain|expert|advis|teach|reassur/i;
export const QUESTION_RE = /\?\s*$|^\s*(kya|kaise|kitna|kitni|kyun|kab|kahan|kaun|how|what|why|when|which|should|can|could|is\s+it|do\s+i|does)\b/i;
export const CAUTION_RE = /(pay(ing)?\s+(more\s+|extra\s+|additional\s+)?tax(es)?|tax\s+(dena|bharna|bhar(na)?\s+pad|lag(ega|ta|ti|\s+sakta|\s+sakti))|tax\s+liabilit|taxable|penalt(y|ies)|jurmana|\bfined\b|(pay|paying|a|lag(ega|egi|\s+sakta|\s+sakti)?)\s+fine\b|fine\s+(lag|of|amount)|late\s+(fee|payment\s+charge)|(foreclosure|prepayment|bounce|hidden|extra|additional)\s+charges?|charges?\s+(lag|apply|may\s+apply)|default(ed|ing|\s+kar)|credit\s+score\s+(drop|fall|gir|kharab|kam)|legal\s+action|be\s+careful|savdh?aan|dhyan\s+(rakh|dena|dijiye)|nuksaan|loss\s+of|risk)/i;
export const CAUTION_NOT = /tax\s+(benefit|saving|deduction|rebate|exemption|free)|risk[-\s]free|(no|zero|without|bina|koi\s+bhi\s+nahi)\s+(kisi\s+|any\s+)?(hidden\s+|extra\s+|additional\s+)?(penalt|charge|fee|risk)|(charges?|penalty|fees?)\s+(nahi|nahin|nhi)\b/i;
export const INTEREST_RE = /(कम\s*ब्याज|ब्याज\s*(दर\s*)?(भी\s*)?(कम|लो)|(कम|लो)\s*इंटरेस्ट|इंटरेस्ट\s*रेट\s*(भी\s*)?(कम|लो)|कॉम्पिटिटिव\s*(इंटरेस्ट|ब्याज)|low(er|est)?[\s-]+(interest|rates?\b|byaj|emi)|(competitive|attractive|affordable|best|reduced|kam|sasti?)\s+(interest|byaj|rates?\b)|interest\s+rates?\s+(are\s+|is\s+|bhi\s+)?(very\s+|kaafi\s+|bahut\s+)?(low|kam|competitive|attractive|affordable)|byaj\s+(dar\s+)?(kam|low)|kam\s+byaj|low[- ]cost\s+(loan|emi)|starting\s+(at|from)\s+[\d.]+\s*%)/i;
export const BENEFIT_RE = /(low(er|est)?\s+(interest|rate|emi)|(competitive|attractive|affordable|best)\s+interest|interest\s+rates?\s+(are\s+)?(low|competitive|attractive)|kam\s+(byaj|emi|interest|tax)|sav(e|es|ed|ing|ings)\b|bachat|paise\s+bach|less\s+tax|tax\s+(benefit|saving|deduction|exemption)|cashback|discount|affordab|emergency\s+(fund|savings)|financial(ly)?\s+(benefit|secure|goal))/i;
export const NUMBER_RE = /(\d+(\.\d+)?[\s-]*(%|percent|pratishat|months?|mahine|years?|saal|lakh|crore|rupees|₹))|(₹\s*\d)/i;
export const TAKEAWAY_RE = /^\s*(exactly|bilkul(\s+sahi)?|absolutely right|you('| a)re (absolutely )?right|sahi (kaha|baat))\b|now i('|\s+a)m clear|ab (main|mujhe|sab) .{0,12}clear|samajh (gaya|aa gaya|gayi)|key takeaway|toh (yaad|summary)|in short|to sum up/i;
export const MOOD_MAP: [RegExp, string, 'emotion' | 'sfx', 'before' | 'after'][] = [
  [/hesitant|worried|nervous|anxious|scared|doubt|unsure|tense|concern/, 'heartbeat', 'emotion', 'after'],
  [/relieved|relief|reassur|hopeful|grateful|gentle/, 'relief', 'emotion', 'before'],
  [/curious|wonder|confused|question/, 'question', 'emotion', 'before'],
  [/surprised|shocked|amazed|astonish/, 'aha', 'emotion', 'after'],
  [/laugh|amused|joking|playful|funny|teasing/, 'laugh', 'emotion', 'after'],
  [/sad|emotional|nostalgic|sombre|somber/, 'sad', 'emotion', 'after'],
  [/confident|encouraging|celebrat|proud|enthusias|excited|energetic/, 'success', 'sfx', 'before'],
];
export const VOICE_TAGS = /^(laughs?|laughing|chuckles?|giggles?|whispers?|whispering|sighs?|excited|sarcastic|curious|crying|pause|short pause|long pause|shouting|happy|sad|angry|thoughtful|clears throat|gasps?|exhales?|inhales?)$/i;
