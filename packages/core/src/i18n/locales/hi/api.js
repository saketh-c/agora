/**
 * Text for API responses (packages/server): errors, rate limits, address lookups, and the template
 * answer for an agenda item. Every error response also carries a stable code, so the web app can
 * show its own dictionary text instead of this one.
 */
export default {
  rateLimited: {
    one: 'पिछले एक मिनट में आपके नेटवर्क से बहुत ज़्यादा अनुरोध आए। एक ही Wi-Fi पर सबके अनुरोध एक साथ गिने जाते हैं, इसलिए {n} सेकंड बाद फिर से कोशिश करें।',
    other: 'पिछले एक मिनट में आपके नेटवर्क से बहुत ज़्यादा अनुरोध आए। एक ही Wi-Fi पर सबके अनुरोध एक साथ गिने जाते हैं, इसलिए {n} सेकंड बाद फिर से कोशिश करें।',
  },
  notFound: 'नहीं मिला',
  invalidJson: 'अनुरोध की बॉडी सही JSON नहीं है।',
  bodyTooLarge: 'अनुरोध बहुत बड़ा है।',
  serverError: 'सर्वर पर कुछ गड़बड़ हो गई। थोड़ी देर में फिर से कोशिश करें।',
  invalidField: 'फ़ील्ड "{field}" टेक्स्ट होना चाहिए।',
  invalidBody: 'अनुरोध JSON ऑब्जेक्ट के रूप में भेजें।',
  missingQuery: 'खोजने के लिए ZIP कोड या पता टाइप करें।',
  missingTitle: 'जिस एजेंडा आइटम को समझना है, उसका शीर्षक भेजें।',
  geoNotFound: "हमें Dallas-Fort Worth में वह जगह नहीं मिली। स्पेलिंग जाँचें, या ZIP कोड या अपने शहर का नाम आज़माएँ।",
  geoOutside: '{place} उस Dallas-Fort Worth इलाके से बाहर है जिसकी जानकारी Agora देता है। इसके बजाय सूची में से कोई शहर चुनें।',
  geoOutsideZip: 'ZIP कोड {zip} उस Dallas-Fort Worth इलाके से बाहर है जिसकी जानकारी Agora देता है। इसके बजाय सूची में से कोई शहर चुनें।',
  geoBusy: 'पते की खोज अभी व्यस्त है। कुछ सेकंड बाद फिर से कोशिश करें।',
  geoUnavailable: "पते की खोज अभी उपलब्ध नहीं है। इसके बजाय सूची में से अपना शहर चुनें; दूरी उसके सिटी हॉल से मापी जाएगी।",
  explainOnAgenda: 'यह आइटम एक सिटी काउंसिल के एजेंडे में है।',
  explainWeighIn: 'अपनी राय देने के लिए, बैठक शुरू होने से पहले सार्वजनिक टिप्पणी के लिए साइन अप करें।',
};
