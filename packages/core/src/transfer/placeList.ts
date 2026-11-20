/**
 * The place words a title is searched for: every country, the adjective for
 * its people where English has a common one, and a modest set of well-known
 * regions and US states. It is a fixed list of general knowledge about the
 * world, not of any one channel's subjects; a place missing from it is simply
 * not recognised.
 *
 * One row per place: the key, then the name shown, then the other words that
 * mean the same place, separated by "|". A country's key is its two-letter ISO
 * 3166 code, which is also what YouTube's official API gives as a channel's
 * country; a region's or state's key is spelt out, since it has no such code.
 * A word ending in "!" counts only when written in capitals.
 *
 * Left out on purpose, because the word is more often something else: Chad
 * and Jordan (first names), Polish (to polish), English (the language) and
 * Kiwi (the fruit). Words that are also ordinary nouns when written small,
 * such as turkey and china, are told apart by the capital-letter rule in
 * `places.ts`. Georgia is listed once, as the country: a title cannot say
 * which of the two it means.
 */
const COUNTRIES = `
AF Afghanistan|afghan
AL Albania|albanian
DZ Algeria|algerian
AD Andorra
AO Angola|angolan
AG Antigua and Barbuda|antigua
AR Argentina|argentine|argentinian
AM Armenia|armenian
AU Australia|australian|aussie
AT Austria|austrian
AZ Azerbaijan|azerbaijani
BS Bahamas|bahamian
BH Bahrain|bahraini
BD Bangladesh|bangladeshi
BB Barbados|barbadian|bajan
BY Belarus|belarusian
BE Belgium|belgian
BZ Belize|belizean
BJ Benin
BT Bhutan|bhutanese
BO Bolivia|bolivian
BA Bosnia|bosnia and herzegovina|bosnian
BW Botswana
BR Brazil|brazilian
BN Brunei
BG Bulgaria|bulgarian
BF Burkina Faso
BI Burundi
KH Cambodia|cambodian
CM Cameroon|cameroonian
CA Canada|canadian
CV Cape Verde
CF Central African Republic
CL Chile|chilean
CN China|chinese
CO Colombia|colombian
KM Comoros
CG Congo|congolese
CD DR Congo|drc!|democratic republic of the congo
CR Costa Rica|costa rican
CI Ivory Coast|cote d'ivoire|ivorian
HR Croatia|croatian
CU Cuba|cuban
CY Cyprus|cypriot
CZ Czechia|czech republic|czech
DK Denmark|danish
DJ Djibouti
DM Dominica
DO Dominican Republic|dominican
EC Ecuador|ecuadorian
EG Egypt|egyptian
SV El Salvador|salvadoran
GQ Equatorial Guinea
ER Eritrea|eritrean
EE Estonia|estonian
SZ Eswatini|swaziland
ET Ethiopia|ethiopian
FJ Fiji|fijian
FI Finland|finnish
FR France|french
GA Gabon
GM Gambia|gambian
GE Georgia|georgian
DE Germany|german
GH Ghana|ghanaian
GR Greece|greek
GD Grenada
GT Guatemala|guatemalan
GN Guinea
GW Guinea-Bissau
GY Guyana|guyanese
HT Haiti|haitian
HN Honduras|honduran
HK Hong Kong
HU Hungary|hungarian
IS Iceland|icelandic
IN India|indian
ID Indonesia|indonesian
IR Iran|iranian
IQ Iraq|iraqi
IE Ireland|irish
IL Israel|israeli
IT Italy|italian
JM Jamaica|jamaican
JP Japan|japanese
KZ Kazakhstan|kazakh
KE Kenya|kenyan
KI Kiribati
KW Kuwait|kuwaiti
KG Kyrgyzstan|kyrgyz
LA Laos|laotian
LV Latvia|latvian
LB Lebanon|lebanese
LS Lesotho
LR Liberia|liberian
LY Libya|libyan
LI Liechtenstein
LT Lithuania|lithuanian
LU Luxembourg
MG Madagascar|malagasy
MW Malawi|malawian
MY Malaysia|malaysian
MV Maldives
ML Mali|malian
MT Malta|maltese
MR Mauritania
MU Mauritius|mauritian
MX Mexico|mexican
MD Moldova|moldovan
MC Monaco
MN Mongolia|mongolian
ME Montenegro
MA Morocco|moroccan
MZ Mozambique|mozambican
MM Myanmar|burma|burmese
NA Namibia|namibian
NP Nepal|nepali|nepalese
NL Netherlands|holland|dutch
NZ New Zealand|new zealander
NI Nicaragua|nicaraguan
NE Niger
NG Nigeria|nigerian
KP North Korea|north korean
MK North Macedonia|macedonia|macedonian
NO Norway|norwegian
OM Oman|omani
PK Pakistan|pakistani
PS Palestine|palestinian
PA Panama|panamanian
PG Papua New Guinea
PY Paraguay|paraguayan
PE Peru|peruvian
PH Philippines|filipino|philippine
PL Poland
PT Portugal|portuguese
PR Puerto Rico|puerto rican
QA Qatar|qatari
RO Romania|romanian
RU Russia|russian
RW Rwanda|rwandan
KN Saint Kitts and Nevis|st kitts|saint kitts
LC Saint Lucia|st lucia
VC Saint Vincent|st vincent
WS Samoa|samoan
SA Saudi Arabia|saudi
SN Senegal|senegalese
RS Serbia|serbian
SC Seychelles
SL Sierra Leone
SG Singapore|singaporean
SK Slovakia|slovak
SI Slovenia|slovenian
SB Solomon Islands
SO Somalia|somali
ZA South Africa|south african
KR South Korea|south korean|korea|korean
SS South Sudan
ES Spain|spanish
LK Sri Lanka|sri lankan
SD Sudan|sudanese
SR Suriname|surinamese
SE Sweden|swedish
CH Switzerland|swiss
SY Syria|syrian
TW Taiwan|taiwanese
TJ Tajikistan
TZ Tanzania|tanzanian
TH Thailand|thai
TL Timor-Leste|east timor
TG Togo
TO Tonga|tongan
TT Trinidad and Tobago|trinidad|trinidadian
TN Tunisia|tunisian
TR Turkey|turkiye|turkish
TM Turkmenistan
UG Uganda|ugandan
UA Ukraine|ukrainian
AE UAE|uae!|united arab emirates|emirati|dubai|abu dhabi
GB UK|uk!|u.k.|united kingdom|britain|great britain|british|briton
US America|american|united states of america|united states|usa!|u.s.a.|u.s.|us!
UY Uruguay|uruguayan
UZ Uzbekistan|uzbek
VU Vanuatu
VE Venezuela|venezuelan
VN Vietnam|vietnamese
YE Yemen|yemeni
ZM Zambia|zambian
ZW Zimbabwe|zimbabwean
`;

/** Parts of the world and of the UK that titles name as often as countries. */
const REGIONS = `
Africa|african
Asia|asian
Europe|european
Middle East|middle eastern
Latin America|latin american
South America|south american
Caribbean
Scandinavia|scandinavian
Balkans|balkan
Arctic
England
Scotland|scottish
Wales|welsh
`;

/** The US states titles name most; the others are rare enough to do without. */
const STATES = `
Texas|texan
California|californian
Florida|floridian
Alaska|alaskan
Hawaii|hawaiian
New York
Arizona
Nevada
Ohio
Michigan
Colorado
Utah
`;

export interface PlaceEntry {
  /** A country's ISO code ("ZA"), or "region:africa", "state:texas". */
  readonly key: string;
  /** The name shown, such as "South Africa". */
  readonly name: string;
  /** Every way of writing the place, in lower case, the name included. */
  readonly words: readonly string[];
  /** The words among them that count only when written in capitals ("US"). */
  readonly capitalsOnly: readonly string[];
}

const CAPITALS_ONLY_MARK = '!';

const rowsOf = (block: string): readonly string[] =>
  block
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.length > 0);

function entry(key: string, spelt: string): PlaceEntry {
  const [name = '', ...others] = spelt.split('|');
  const plain = (word: string): string => word.replace(CAPITALS_ONLY_MARK, '').toLowerCase();
  return {
    key,
    name,
    words: [...new Set([name, ...others].map(plain))],
    capitalsOnly: others.filter((word) => word.endsWith(CAPITALS_ONLY_MARK)).map(plain),
  };
}

const slug = (name: string): string => name.toLowerCase().replace(/\s+/g, '-');

/** Every place a title is searched for. */
export const PLACE_ENTRIES: readonly PlaceEntry[] = [
  ...rowsOf(COUNTRIES).map((row) => entry(row.slice(0, 2), row.slice(3))),
  ...rowsOf(REGIONS).map((row) => entry(`region:${slug(row.split('|')[0] ?? '')}`, row)),
  ...rowsOf(STATES).map((row) => entry(`state:${slug(row.split('|')[0] ?? '')}`, row)),
];
