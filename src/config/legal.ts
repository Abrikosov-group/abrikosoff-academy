export const legalDetails = {
  brandName: "Академия Абрикософф",
  domain: "academy.abrikosoff.com",
  seller: {
    fullName: "Индивидуальный предприниматель Федотова Светлана Геннадьевна",
    shortName: "ИП Федотова Светлана Геннадьевна",
    inn: "262403882602",
    ogrnip: "322265100025161",
    registrationDate: "",
    registrationAuthority: "",
    address:
      "356126, Россия, Ставропольский край, Изобильненский район, посёлок Солнечнодольск, ул. Абрикосовая, д. 42",
  },
  contacts: {
    supportEmail: "support@abrikosoff.com",
    privacyEmail: "support@abrikosoff.com",
    telegram: "@AbrikosoffBot",
    telegramUrl: "https://t.me/AbrikosoffBot",
    phone: "+7 (958) 111-07-75",
    supportHours: "ежедневно с 10:00 до 19:00 (мск)",
  },
  payments: {
    provider: "ЮKassa",
    vat: "Без НДС",
    receiptItemName: "Доступ к материалам Академии Абрикософф",
  },
} as const;

export function hasSellerDetails() {
  return Boolean(
    legalDetails.seller.inn &&
      legalDetails.seller.ogrnip &&
      legalDetails.seller.address,
  );
}
