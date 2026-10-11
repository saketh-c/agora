/**
 * Text for API responses (packages/server): errors, rate limits, address lookups, and the template
 * answer for an agenda item. Every error response also carries a stable code, so the web app can
 * show its own dictionary text instead of this one.
 */
export default {
  rateLimited: {
    one: 'గత నిమిషంలో మీ నెట్‌వర్క్ నుంచి చాలా ఎక్కువ రిక్వెస్ట్‌లు వచ్చాయి. ఒకే Wi-Fi లో ఉన్న అందరినీ కలిపి లెక్కిస్తాము, కాబట్టి {n} సెకనులో మళ్లీ ప్రయత్నించండి.',
    other: 'గత నిమిషంలో మీ నెట్‌వర్క్ నుంచి చాలా ఎక్కువ రిక్వెస్ట్‌లు వచ్చాయి. ఒకే Wi-Fi లో ఉన్న అందరినీ కలిపి లెక్కిస్తాము, కాబట్టి {n} సెకన్లలో మళ్లీ ప్రయత్నించండి.',
  },
  notFound: 'కనబడలేదు',
  invalidJson: 'రిక్వెస్ట్ బాడీ సరైన JSON కాదు.',
  bodyTooLarge: 'రిక్వెస్ట్ చాలా పెద్దగా ఉంది.',
  serverError: 'సర్వర్‌లో ఏదో తప్పు జరిగింది. కాసేపట్లో మళ్లీ ప్రయత్నించండి.',
  invalidField: '"{field}" ఫీల్డ్ టెక్స్ట్ అయి ఉండాలి.',
  invalidBody: 'రిక్వెస్ట్‌ను JSON ఆబ్జెక్ట్‌గా పంపండి.',
  missingQuery: 'వెతకడానికి ZIP కోడ్ లేదా చిరునామా టైప్ చేయండి.',
  missingTitle: 'మీకు వివరించాల్సిన అజెండా అంశం శీర్షికను పంపండి.',
  geoNotFound: "ఆ ప్రదేశం Dallas-Fort Worth లో మాకు దొరకలేదు. స్పెల్లింగ్ సరిచూడండి, లేదా ZIP కోడ్ గానీ మీ నగరం పేరు గానీ ప్రయత్నించండి.",
  geoOutside: '{place}, Agora కవర్ చేసే Dallas-Fort Worth ప్రాంతం బయట ఉంది. బదులుగా జాబితాలోని నగరాల్లో ఒకటి ఎంచుకోండి.',
  geoOutsideZip: 'ZIP కోడ్ {zip}, Agora కవర్ చేసే Dallas-Fort Worth ప్రాంతం బయట ఉంది. బదులుగా జాబితాలోని నగరాల్లో ఒకటి ఎంచుకోండి.',
  geoBusy: 'చిరునామా శోధన ప్రస్తుతం బిజీగా ఉంది. కొన్ని సెకన్లలో మళ్లీ ప్రయత్నించండి.',
  geoUnavailable: "చిరునామా శోధన ప్రస్తుతం అందుబాటులో లేదు. బదులుగా జాబితా నుంచి మీ నగరాన్ని ఎంచుకోండి; దూరాలను ఆ నగర సిటీ హాల్ నుంచి కొలుస్తాము.",
  explainOnAgenda: 'ఈ అంశం ఒక సిటీ కౌన్సిల్ అజెండాలో ఉంది.',
  explainWeighIn: 'మీ అభిప్రాయం చెప్పాలంటే, సమావేశం మొదలయ్యే ముందే పబ్లిక్ కామెంట్ కోసం నమోదు చేసుకోండి.',
};
