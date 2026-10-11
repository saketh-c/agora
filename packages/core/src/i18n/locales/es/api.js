/** Text for API responses (packages/server). Keys mirror en/api.js. */
export default {
  rateLimited: 'Llegaron demasiadas solicitudes desde tu red en el último minuto. Todos los que usan el mismo wifi cuentan juntos, así que vuelve a intentarlo en {n} segundos.',
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
};
