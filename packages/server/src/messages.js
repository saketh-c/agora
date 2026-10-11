import { isLocale } from '@agora/core';

/**
 * Human-readable text for API responses, in every language the app speaks.
 *
 * These live with the server rather than in core's UI dictionaries because they describe
 * the API itself (a rate limit, an address lookup that found nothing) to any client. Every
 * error response also carries a stable `code`, so the web app can show its own dictionary
 * text instead of this one. The same rules as the UI dictionaries apply: every key exists in
 * en, es and vi with the same {params}, Spanish uses informal "tú", and no em or en dashes.
 */
export const API_MESSAGES = Object.freeze({
  en: {
    rateLimited: 'Too many requests came from your network in the last minute. Everyone on the same Wi-Fi counts together, so try again in {seconds} seconds.',
    notFound: 'Not found',
    invalidJson: 'The request body is not valid JSON.',
    bodyTooLarge: 'The request is too large.',
    serverError: 'Something went wrong on the server. Try again in a moment.',
    invalidField: 'The field "{field}" must be text.',
    invalidBody: 'Send the request as a JSON object.',
    missingQuery: 'Type a ZIP code or an address to look up.',
    missingTitle: 'Send the title of the agenda item you want explained.',
    geoNotFound: "We couldn't find that place in Dallas-Fort Worth. Check the spelling, or try a ZIP code or your city's name.",
    geoOutside: '{place} is outside the Dallas-Fort Worth area that Agora covers. Pick one of the cities on the list instead.',
    geoOutsideZip: 'ZIP code {zip} is outside the Dallas-Fort Worth area that Agora covers. Pick one of the cities on the list instead.',
    geoBusy: 'Address lookup is busy right now. Try again in a few seconds.',
    geoUnavailable: "Address lookup isn't available right now. Pick your city from the list instead; distances will measure from its city hall.",
    explainOnAgenda: 'This item is on a city council agenda.',
    explainWeighIn: 'To weigh in, sign up for public comment before the meeting starts.',
  },
  es: {
    rateLimited: 'Llegaron demasiadas solicitudes desde tu red en el último minuto. Todos los que usan el mismo wifi cuentan juntos, así que vuelve a intentarlo en {seconds} segundos.',
    notFound: 'No se encontró',
    invalidJson: 'El cuerpo de la solicitud no es JSON válido.',
    bodyTooLarge: 'La solicitud es demasiado grande.',
    serverError: 'Algo falló en el servidor. Vuelve a intentarlo en un momento.',
    invalidField: 'El campo "{field}" tiene que ser texto.',
    invalidBody: 'Envía la solicitud como un objeto JSON.',
    missingQuery: 'Escribe un código postal o una dirección para buscar.',
    missingTitle: 'Envía el título del punto de la agenda que quieres que te expliquemos.',
    geoNotFound: 'No encontramos ese lugar en Dallas-Fort Worth. Revisa cómo lo escribiste o prueba con un código postal o el nombre de tu ciudad.',
    geoOutside: '{place} está fuera del área de Dallas-Fort Worth que cubre Agora. Mejor elige una de las ciudades de la lista.',
    geoOutsideZip: 'El código postal {zip} está fuera del área de Dallas-Fort Worth que cubre Agora. Mejor elige una de las ciudades de la lista.',
    geoBusy: 'La búsqueda de direcciones está ocupada en este momento. Vuelve a intentarlo en unos segundos.',
    geoUnavailable: 'La búsqueda de direcciones no está disponible en este momento. Mejor elige tu ciudad de la lista; las distancias se medirán desde su ayuntamiento.',
    explainOnAgenda: 'Este punto está en la agenda de un concejo municipal.',
    explainWeighIn: 'Para opinar, inscríbete para hacer un comentario público antes de que empiece la reunión.',
  },
  vi: {
    rateLimited: 'Mạng của bạn đã gửi quá nhiều yêu cầu trong một phút vừa qua. Mọi người dùng chung Wi-Fi được tính chung, nên hãy thử lại sau {seconds} giây.',
    notFound: 'Không tìm thấy',
    invalidJson: 'Nội dung yêu cầu không phải là JSON hợp lệ.',
    bodyTooLarge: 'Yêu cầu quá lớn.',
    serverError: 'Máy chủ gặp sự cố. Hãy thử lại sau giây lát.',
    invalidField: 'Trường "{field}" phải là văn bản.',
    invalidBody: 'Hãy gửi yêu cầu dưới dạng một đối tượng JSON.',
    missingQuery: 'Hãy nhập mã ZIP hoặc địa chỉ để tìm.',
    missingTitle: 'Hãy gửi tiêu đề của mục trong chương trình nghị sự mà bạn muốn được giải thích.',
    geoNotFound: 'Chúng tôi không tìm thấy địa điểm đó ở Dallas-Fort Worth. Hãy kiểm tra chính tả, hoặc thử mã ZIP hay tên thành phố của bạn.',
    geoOutside: '{place} nằm ngoài khu vực Dallas-Fort Worth mà Agora hỗ trợ. Thay vào đó, hãy chọn một thành phố trong danh sách.',
    geoOutsideZip: 'Mã ZIP {zip} nằm ngoài khu vực Dallas-Fort Worth mà Agora hỗ trợ. Thay vào đó, hãy chọn một thành phố trong danh sách.',
    geoBusy: 'Chức năng tìm địa chỉ đang bận. Hãy thử lại sau vài giây.',
    geoUnavailable: 'Chức năng tìm địa chỉ hiện không hoạt động. Thay vào đó, hãy chọn thành phố của bạn trong danh sách; khoảng cách sẽ được tính từ tòa thị chính.',
    explainOnAgenda: 'Mục này nằm trong chương trình nghị sự của một hội đồng thành phố.',
    explainWeighIn: 'Để góp ý, hãy đăng ký phát biểu ý kiến công chúng trước khi cuộc họp bắt đầu.',
  },
});

/**
 * An API message in the given language (English when the language or key is unknown), with
 * {param} placeholders filled in.
 * @param {keyof API_MESSAGES['en']} key
 * @param {Record<string, string|number>} [params]
 * @param {string} [lang]
 */
export function apiMessage(key, params, lang) {
  const dict = isLocale(lang) && API_MESSAGES[lang] ? API_MESSAGES[lang] : API_MESSAGES.en;
  const template = dict[key] || API_MESSAGES.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (m, name) => (params && params[name] !== undefined && params[name] !== null ? String(params[name]) : m));
}
