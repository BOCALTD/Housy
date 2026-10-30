/**
 * The demonstration catalogue: sample companies, agents and properties with photographs, so a fresh install with
 * SEED_DEMO_DATA=true looks like a working marketplace. Everything here is invented. Photos are Unsplash pictures
 * (prisma/demo-media/photos/CREDITS.md) and do not show these properties. A strip on every page says the data is a sample.
 */

export type DemoCompany = {
  key: string; legalName: string; displayName: string; kind: "COMPANY" | "DEVELOPER"; tagline: string; about: string;
  owner: { name: string; email: string }; agents: { name: string; email: string; headline: string; bio: string }[];
  city: string; state: string; address: string; plan?: "company-gold" | "company-silver";
};

export type DemoListing = {
  company: string; agent?: number; name: string; category: string; cls: "RESIDENTIAL" | "COMMERCIAL" | "INDUSTRIAL" | "LAND";
  city: string; state: string; area: string; lat: number; lng: number;
  photos: [string, string][];
  listing: Record<string, unknown>;
  reel?: string;
};

export const DEMO_COMPANIES: DemoCompany[] = [
  {
    key: "lekki", legalName: "[DEMO] Lekki Prime Homes Ltd", displayName: "Lekki Prime Homes", kind: "COMPANY", plan: "company-gold",
    tagline: "Luxury homes and apartments in Lekki, Ikoyi and Victoria Island",
    about: "A sample agency for the demonstration. Sales, lettings and short lets on the Lagos Island side, with every viewing booked through the platform.",
    owner: { name: "Tolu Adebayo", email: "demo.lekki@example.test" },
    agents: [
      { name: "Kemi Balogun", email: "demo.kemi.agent@example.test", headline: "Luxury sales, Lekki Phase 1 and Ikoyi", bio: "Sample agent profile. Ten years selling family homes and apartments on the Island. Viewings seven days a week." },
      { name: "Daniel Okoro", email: "demo.daniel.agent@example.test", headline: "Short lets and serviced apartments, Victoria Island", bio: "Sample agent profile. Furnished apartments for business travellers and families relocating to Lagos." },
    ],
    city: "Lekki", state: "Lagos", address: "12 Admiralty Way, Lekki Phase 1",
  },
  {
    key: "abuja", legalName: "[DEMO] Capital Realty Ltd", displayName: "Capital Realty", kind: "COMPANY", plan: "company-silver",
    tagline: "Homes and offices across Abuja: Maitama, Asokoro, Wuse and Gwarinpa",
    about: "A sample agency for the demonstration. Residential sales, diplomatic lettings and office space in the Federal Capital Territory.",
    owner: { name: "Ibrahim Musa", email: "demo.abuja@example.test" },
    agents: [
      { name: "Halima Yusuf", email: "demo.halima.agent@example.test", headline: "Maitama and Asokoro homes", bio: "Sample agent profile. Large family homes and diplomatic lettings in central Abuja." },
      { name: "Chuka Obi", email: "demo.chuka.agent@example.test", headline: "Gwarinpa, Jabi and Wuse 2 rentals", bio: "Sample agent profile. Apartments and terraces for young professionals and families." },
    ],
    city: "Maitama", state: "FCT Abuja", address: "4 Aguiyi Ironsi Street, Maitama",
  },
  {
    key: "ph", legalName: "[DEMO] Garden City Properties Ltd", displayName: "Garden City Properties", kind: "COMPANY",
    tagline: "Port Harcourt homes, offices and warehouses",
    about: "A sample agency for the demonstration. Family homes in GRA and commercial space on Trans-Amadi for oil and gas firms.",
    owner: { name: "Ebi Pepple", email: "demo.ph@example.test" },
    agents: [
      { name: "Grace Wike", email: "demo.grace.agent@example.test", headline: "Old GRA and New GRA homes", bio: "Sample agent profile. Bungalows and duplexes in the GRAs, and help with relocating to Port Harcourt." },
    ],
    city: "Port Harcourt", state: "Rivers", address: "21 Aba Road, Port Harcourt",
  },
  {
    key: "west", legalName: "[DEMO] Heritage Homes Developers Ltd", displayName: "Heritage Homes Developers", kind: "DEVELOPER",
    tagline: "New estates in Lagos, Ibadan and Enugu, with payment plans",
    about: "A sample developer for the demonstration. Off-plan and newly completed homes with staged payment plans.",
    owner: { name: "Funmi Coker", email: "demo.heritage@example.test" },
    agents: [
      { name: "Segun Afolabi", email: "demo.segun.agent@example.test", headline: "New homes in Ajah, Ibadan and Enugu", bio: "Sample agent profile. Off-plan sales and site inspections every Saturday." },
    ],
    city: "Ajah", state: "Lagos", address: "Plot 5, Abraham Adesanya Road, Ajah",
  },
];

const P = (...files: string[]): [string, string][] => files.map((f) => [f, ({ ext: "Front view", block: "The building", living: "Living room", dining: "Dining area", bed: "Main bedroom", kitchen: "Kitchen", bath: "Bathroom", pool: "Pool and terrace", office: "Office floor", warehouse: "Inside the warehouse", shop: "Shop floor" } as Record<string, string>)[f.split("-")[0]] ?? "Photo"]);
const year = new Date().getUTCFullYear();

export const DEMO_LISTINGS: DemoListing[] = [
  // ---------- Lagos ----------
  { company: "lekki", agent: 0, name: "5-bedroom house with pool, Lekki Phase 1", category: "House", cls: "RESIDENTIAL", city: "Lekki", state: "Lagos", area: "Lekki Phase 1", lat: 6.4478, lng: 3.4737,
    photos: P("ext-20", "living-23", "kitchen-07", "dining-02", "bed-10", "bath-03", "pool-02"),
    listing: { title: "5-bedroom detached house with pool and cinema room", purpose: "SALE", price: "450,000,000", bedrooms: "5", bathrooms: "6", toilets: "7", propertyType: "HOUSE", floors: "2", buildingSqm: "620", landSqm: "900", furnishing: "SEMI_FURNISHED", condition: "NEW", constructionStatus: "COMPLETED", amenities: ["POOL", "GATED", "SECURITY", "CCTV", "BOYS_QUARTERS", "FITTED_KITCHEN", "SOLAR", "BOREHOLE", "PARKING", "AIR_CON", "GYM"], titleDocument: "GOVERNORS_CONSENT", estateName: "Oniru Gardens", negotiable: "yes", description: "Sample listing. A new five-bedroom home on a quiet close: double-height living room opening onto the pool, a cinema room, a fitted kitchen with island, and a two-room boys' quarters. Full solar back-up and a borehole with treatment plant." },
    reel: "A walk through the 5-bedroom pool house in Lekki Phase 1" },
  { company: "lekki", agent: 0, name: "3-bedroom apartment, Banana Island", category: "Apartment", cls: "RESIDENTIAL", city: "Ikoyi", state: "Lagos", area: "Banana Island", lat: 6.4636, lng: 3.4495,
    photos: P("block-06", "living-13", "kitchen-08", "bed-11", "bath-02"),
    listing: { title: "3-bedroom waterfront apartment with gym and pool", purpose: "RENT", pricePeriod: "YEAR", price: "38,000,000", bedrooms: "3", bathrooms: "4", toilets: "4", propertyType: "FLAT", furnishing: "UNFURNISHED", condition: "NEW", serviced: "yes", amenities: ["POOL", "GYM", "ELEVATOR", "SECURITY", "CCTV", "GENERATOR", "PARKING", "AIR_CON", "WATER"], serviceCharge: "6,000,000", deposit: "3,000,000", minLeaseMonths: "12", description: "Sample listing. Lagoon views from every room, 24-hour power and security, a residents' gym and pool. Service charge covers diesel, cleaning of shared areas and security." },
    reel: "Lagoon views: the Banana Island apartment" },
  { company: "lekki", agent: 1, name: "Serviced 2-bedroom, Victoria Island", category: "Apartment", cls: "RESIDENTIAL", city: "Victoria Island", state: "Lagos", area: "Oniru", lat: 6.4300, lng: 3.4262,
    photos: P("block-04", "living-18", "bed-08", "kitchen-09", "bath-01"),
    listing: { title: "Serviced 2-bedroom short let near the beach", purpose: "RENT", pricePeriod: "NIGHT", price: "120,000", bedrooms: "2", bathrooms: "2", toilets: "3", propertyType: "FLAT", furnishing: "FURNISHED", serviced: "yes", condition: "RENOVATED", amenities: ["AIR_CON", "INTERNET", "GENERATOR", "SECURITY", "ELEVATOR", "PARKING", "POOL"], deposit: "150,000", description: "Sample listing. Fully furnished, cleaned daily, fast internet and 24-hour power. Minimum two nights; weekly and monthly rates on request." } },
  { company: "lekki", agent: 0, name: "Penthouse, Lekki", category: "Penthouse", cls: "RESIDENTIAL", city: "Lekki", state: "Lagos", area: "Lekki Phase 1", lat: 6.4422, lng: 3.4801,
    photos: P("ext-16", "living-24", "kitchen-04", "bed-09", "pool-01"),
    listing: { title: "4-bedroom penthouse with rooftop terrace and plunge pool", purpose: "SALE", price: "550,000,000", bedrooms: "4", bathrooms: "5", toilets: "5", propertyType: "PENTHOUSE", buildingSqm: "480", furnishing: "FURNISHED", condition: "NEW", constructionStatus: "COMPLETED", amenities: ["POOL", "ELEVATOR", "SECURITY", "CCTV", "GENERATOR", "AIR_CON", "BALCONY", "PARKING", "FITTED_KITCHEN"], titleDocument: "C_OF_O", negotiable: "yes", description: "Sample listing. The top two floors of a boutique building: private lift, a 120 m² rooftop terrace with plunge pool, and views across the Lekki lagoon." },
    reel: "Rooftop terrace and plunge pool: Lekki penthouse" },
  { company: "lekki", agent: 1, name: "Studio short let, Lekki", category: "Studio", cls: "RESIDENTIAL", city: "Lekki", state: "Lagos", area: "Chevron", lat: 6.4389, lng: 3.5316,
    photos: P("living-21", "bed-12", "kitchen-06"),
    listing: { title: "Smart studio short let with workspace", purpose: "RENT", pricePeriod: "NIGHT", price: "45,000", bedrooms: "1", bathrooms: "1", toilets: "1", propertyType: "SELF_CONTAINED", furnishing: "FURNISHED", serviced: "yes", condition: "NEW", amenities: ["AIR_CON", "INTERNET", "SOLAR", "SECURITY", "PARKING"], deposit: "50,000", description: "Sample listing. A compact studio for one or two guests with a proper desk, fast internet and solar back-up." } },
  { company: "lekki", agent: 0, name: "4-bedroom maisonette, Ikoyi", category: "Maisonette", cls: "RESIDENTIAL", city: "Ikoyi", state: "Lagos", area: "Old Ikoyi", lat: 6.4512, lng: 3.4339,
    photos: P("ext-14", "living-26", "dining-03", "bed-04", "kitchen-02"),
    listing: { title: "4-bedroom maisonette in a compound of six", purpose: "RENT", pricePeriod: "YEAR", price: "28,000,000", bedrooms: "4", bathrooms: "4", toilets: "5", propertyType: "MAISONETTE", furnishing: "UNFURNISHED", condition: "RENOVATED", amenities: ["SECURITY", "GATED", "GENERATOR", "BOREHOLE", "PARKING", "GARDEN", "BOYS_QUARTERS"], serviceCharge: "3,500,000", deposit: "2,500,000", minLeaseMonths: "24", description: "Sample listing. Leafy Old Ikoyi compound, private garden, one-room BQ. Two-year lease preferred." } },
  { company: "alpha", name: "4-bedroom duplex, Ikeja GRA", category: "Duplex", cls: "RESIDENTIAL", city: "Ikeja", state: "Lagos", area: "Ikeja GRA", lat: 6.5794, lng: 3.3565,
    photos: P("ext-11", "living-05", "dining-01", "kitchen-01", "bed-01"),
    listing: { title: "Contemporary 4-bedroom detached duplex", purpose: "SALE", price: "280,000,000", bedrooms: "4", bathrooms: "5", toilets: "5", propertyType: "DUPLEX", floors: "2", buildingSqm: "410", landSqm: "650", furnishing: "UNFURNISHED", condition: "NEW", constructionStatus: "COMPLETED", amenities: ["SECURITY", "GATED", "PARKING", "FITTED_KITCHEN", "WARDROBES", "BOREHOLE", "PREPAID_METER", "CCTV"], titleDocument: "C_OF_O", negotiable: "yes", description: "Sample listing. Five minutes from the airport: open-plan ground floor, family lounge upstairs, all rooms en suite." },
    reel: "Ikeja GRA duplex: from the gate to the family lounge" },
  { company: "alpha", name: "Mini flat, Yaba", category: "Flat", cls: "RESIDENTIAL", city: "Yaba", state: "Lagos", area: "Akoka", lat: 6.5164, lng: 3.3906,
    photos: P("block-03", "living-09", "bed-06", "kitchen-05"),
    listing: { title: "1-bedroom mini flat near UNILAG", purpose: "RENT", pricePeriod: "YEAR", price: "2,800,000", bedrooms: "1", bathrooms: "1", toilets: "1", propertyType: "FLAT", furnishing: "UNFURNISHED", condition: "RENOVATED", amenities: ["PREPAID_METER", "WATER", "SECURITY", "INTERNET"], deposit: "300,000", minLeaseMonths: "12", description: "Sample listing. Newly painted, prepaid meter, ten minutes' walk to the university gate." } },
  { company: "alpha", name: "3-bedroom flat, Surulere", category: "Flat", cls: "RESIDENTIAL", city: "Surulere", state: "Lagos", area: "Adeniran Ogunsanya", lat: 6.4974, lng: 3.3539,
    photos: P("block-01", "living-03", "kitchen-03", "bed-05", "bath-01"),
    listing: { title: "Spacious 3-bedroom flat, newly renovated", purpose: "RENT", pricePeriod: "YEAR", price: "4,500,000", bedrooms: "3", bathrooms: "3", toilets: "4", propertyType: "FLAT", furnishing: "UNFURNISHED", condition: "RENOVATED", amenities: ["PREPAID_METER", "BOREHOLE", "PARKING", "SECURITY", "WARDROBES"], deposit: "450,000", minLeaseMonths: "12", description: "Sample listing. Second floor of a block of six, close to the shopping mall and the National Stadium." } },
  { company: "alpha", name: "5-bedroom house, Magodo", category: "House", cls: "RESIDENTIAL", city: "Magodo", state: "Lagos", area: "Magodo Phase 2", lat: 6.6187, lng: 3.3829,
    photos: P("ext-07", "living-07", "dining-03", "kitchen-03", "bed-03"),
    listing: { title: "5-bedroom detached house with BQ in a gated estate", purpose: "SALE", price: "320,000,000", bedrooms: "5", bathrooms: "6", toilets: "6", propertyType: "HOUSE", floors: "2", buildingSqm: "520", landSqm: "800", condition: "GOOD", constructionStatus: "COMPLETED", amenities: ["GATED", "SECURITY", "BOYS_QUARTERS", "GARDEN", "PARKING", "BOREHOLE", "GENERATOR"], titleDocument: "C_OF_O", estateName: "Magodo GRA", negotiable: "yes", description: "Sample listing. A family home on a large plot in a well-run estate with its own security and road maintenance." } },
  { company: "alpha", name: "Retail shop, Allen Avenue", category: "Shop", cls: "COMMERCIAL", city: "Ikeja", state: "Lagos", area: "Allen Avenue", lat: 6.6018, lng: 3.3515,
    photos: P("shop-01"),
    listing: { title: "Ground-floor retail shop on Allen Avenue", purpose: "LEASE", price: "6,000,000", propertyType: "SHOP", buildingSqm: "85", condition: "GOOD", amenities: ["SECURITY", "PARKING", "GENERATOR", "ACCESSIBLE"], serviceCharge: "800,000", minLeaseMonths: "24", description: "Sample listing. Glass frontage on one of Ikeja's busiest shopping streets, shared parking at the back." } },
  { company: "lekki", agent: 1, name: "Grade A office, Ikoyi", category: "Office", cls: "COMMERCIAL", city: "Ikoyi", state: "Lagos", area: "Kingsway Road", lat: 6.4480, lng: 3.4185,
    photos: P("office-01", "block-05"),
    listing: { title: "Grade A open-plan office floor, 600 m²", purpose: "LEASE", price: "85,000,000", propertyType: "OFFICE", buildingSqm: "600", floors: "1", toilets: "6", condition: "NEW", serviced: "yes", amenities: ["ELEVATOR", "AIR_CON", "GENERATOR", "SECURITY", "PARKING", "INTERNET", "ACCESSIBLE", "CCTV"], serviceCharge: "12,000,000", minLeaseMonths: "36", description: "Sample listing. Full floor with floor-to-ceiling glass, raised floors, backup power and 30 parking bays." } },
  { company: "beta", name: "Warehouse, Apapa", category: "Warehouse", cls: "INDUSTRIAL", city: "Apapa", state: "Lagos", area: "Creek Road", lat: 6.4488, lng: 3.3600,
    photos: P("warehouse-02", "warehouse-01"),
    listing: { title: "3,500 m² bonded warehouse near the port", purpose: "LEASE", price: "120,000,000", propertyType: "WAREHOUSE", buildingSqm: "3500", landSqm: "6000", condition: "GOOD", amenities: ["SECURITY", "FENCED", "LOADING_BAY", "PARKING", "GENERATOR", "CCTV"], minLeaseMonths: "36", deposit: "30,000,000", description: "Sample listing. Racking for 4,000 pallets, eight loading docks, and a short drive to the Apapa terminals." } },
  { company: "west", agent: 0, name: "Terrace, Ajah", category: "Terrace", cls: "RESIDENTIAL", city: "Ajah", state: "Lagos", area: "Abraham Adesanya", lat: 6.4685, lng: 3.5730,
    photos: P("ext-23", "living-15", "kitchen-02", "bed-07"),
    listing: { title: "4-bedroom terrace in a new gated estate", purpose: "SALE", price: "95,000,000", bedrooms: "4", bathrooms: "4", toilets: "5", propertyType: "TERRACE", floors: "3", buildingSqm: "260", condition: "NEW", constructionStatus: "COMPLETED", amenities: ["GATED", "SECURITY", "PARKING", "SOLAR", "FITTED_KITCHEN", "TARRED_ROAD"], titleDocument: "GOVERNORS_CONSENT", estateName: "Heritage Court", description: "Sample listing. Ready to move in, with a 12-month payment plan available on request." } },
  { company: "west", agent: 0, name: "Off-plan homes, Ibeju-Lekki", category: "Duplex", cls: "RESIDENTIAL", city: "Ibeju-Lekki", state: "Lagos", area: "Eleko", lat: 6.4521, lng: 3.8010,
    photos: P("block-02", "living-11", "bed-02"),
    listing: { title: "Off-plan 3-bedroom semi-detached homes, 24-month plan", purpose: "SALE", price: "65,000,000", bedrooms: "3", bathrooms: "3", toilets: "4", propertyType: "SEMI_DETACHED", constructionStatus: "OFF_PLAN", buildingSqm: "210", condition: "NEW", amenities: ["GATED", "SECURITY", "SOLAR", "TARRED_ROAD", "DRAINAGE"], titleDocument: "DEED_OF_ASSIGNMENT", estateName: "Heritage Coast", availableFrom: `${year + 2}-03-31`, description: "Sample listing. 30% deposit, the balance over 24 months. Close to the Lekki Free Trade Zone and the new airport site." } },
  // ---------- Abuja ----------
  { company: "abuja", agent: 0, name: "6-bedroom mansion, Maitama", category: "House", cls: "RESIDENTIAL", city: "Maitama", state: "FCT Abuja", area: "Maitama", lat: 9.0886, lng: 7.4964,
    photos: P("ext-18", "living-27", "dining-01", "kitchen-08", "bed-02", "bath-02"),
    listing: { title: "6-bedroom mansion with pool and guest chalet", purpose: "SALE", price: "1,200,000,000", bedrooms: "6", bathrooms: "8", toilets: "9", propertyType: "HOUSE", floors: "2", buildingSqm: "950", landSqm: "2200", furnishing: "SEMI_FURNISHED", condition: "GOOD", constructionStatus: "COMPLETED", amenities: ["POOL", "GATED", "SECURITY", "CCTV", "BOYS_QUARTERS", "GARDEN", "SOLAR", "BOREHOLE", "GENERATOR", "GYM", "PARKING"], titleDocument: "C_OF_O", negotiable: "yes", description: "Sample listing. On a 2,200 m² plot in the heart of Maitama: pool, guest chalet, three-room staff quarters and parking for ten cars." },
    reel: "Maitama mansion: pool, chalet and gardens" },
  { company: "abuja", agent: 1, name: "Serviced 2-bedroom, Wuse 2", category: "Apartment", cls: "RESIDENTIAL", city: "Wuse 2", state: "FCT Abuja", area: "Wuse 2", lat: 9.0800, lng: 7.4710,
    photos: P("block-05", "living-20", "bed-07", "kitchen-09"),
    listing: { title: "Serviced 2-bedroom apartment off Aminu Kano Crescent", purpose: "RENT", pricePeriod: "YEAR", price: "7,500,000", bedrooms: "2", bathrooms: "2", toilets: "3", propertyType: "FLAT", furnishing: "FURNISHED", serviced: "yes", condition: "RENOVATED", amenities: ["AIR_CON", "GENERATOR", "SECURITY", "ELEVATOR", "INTERNET", "PARKING", "GYM"], serviceCharge: "1,500,000", deposit: "750,000", minLeaseMonths: "12", description: "Sample listing. Walk to restaurants and banks on Aminu Kano Crescent; power, water and cleaning of shared areas included." },
    reel: "Wuse 2 serviced apartment in one minute" },
  { company: "abuja", agent: 1, name: "4-bedroom duplex, Gwarinpa", category: "Duplex", cls: "RESIDENTIAL", city: "Gwarinpa", state: "FCT Abuja", area: "Gwarinpa", lat: 9.1099, lng: 7.4042,
    photos: P("ext-12", "living-10", "kitchen-05", "bed-08"),
    listing: { title: "4-bedroom semi-detached duplex with BQ", purpose: "SALE", price: "150,000,000", bedrooms: "4", bathrooms: "5", toilets: "5", propertyType: "SEMI_DETACHED", floors: "2", buildingSqm: "330", condition: "NEW", constructionStatus: "COMPLETED", amenities: ["GATED", "SECURITY", "BOYS_QUARTERS", "PARKING", "FITTED_KITCHEN", "PREPAID_METER"], titleDocument: "C_OF_O", estateName: "Gwarinpa Estate", negotiable: "yes", description: "Sample listing. New build on 6th Avenue, close to schools and the Gwarinpa market." } },
  { company: "abuja", agent: 0, name: "Smart home, Asokoro", category: "House", cls: "RESIDENTIAL", city: "Asokoro", state: "FCT Abuja", area: "Asokoro", lat: 9.0437, lng: 7.5250,
    photos: P("ext-13", "living-22", "kitchen-07", "bed-11", "bath-03"),
    listing: { title: "Contemporary 5-bedroom smart home", purpose: "SALE", price: "650,000,000", bedrooms: "5", bathrooms: "6", toilets: "6", propertyType: "HOUSE", floors: "3", buildingSqm: "700", landSqm: "1200", furnishing: "FURNISHED", condition: "NEW", constructionStatus: "COMPLETED", amenities: ["POOL", "SECURITY", "CCTV", "SOLAR", "AIR_CON", "ELEVATOR", "GYM", "PARKING", "GATED"], titleDocument: "C_OF_O", description: "Sample listing. Lights, blinds, security and climate on one app, a home lift, and a full solar system with battery storage." },
    reel: "Asokoro smart home at dusk" },
  { company: "abuja", agent: 1, name: "3-bedroom terrace, Jabi", category: "Terrace", cls: "RESIDENTIAL", city: "Jabi", state: "FCT Abuja", area: "Jabi", lat: 9.0700, lng: 7.4250,
    photos: P("ext-15", "living-19", "bed-01", "kitchen-01"),
    listing: { title: "3-bedroom terrace near Jabi Lake", purpose: "RENT", pricePeriod: "YEAR", price: "9,000,000", bedrooms: "3", bathrooms: "3", toilets: "4", propertyType: "TERRACE", furnishing: "UNFURNISHED", condition: "GOOD", amenities: ["GATED", "SECURITY", "PARKING", "GENERATOR", "BOREHOLE"], serviceCharge: "1,000,000", deposit: "900,000", minLeaseMonths: "12", description: "Sample listing. A short walk to Jabi Lake Mall; estate generator and borehole." } },
  // ---------- Port Harcourt ----------
  { company: "ph", agent: 0, name: "4-bedroom bungalow, Old GRA", category: "Bungalow", cls: "RESIDENTIAL", city: "Port Harcourt", state: "Rivers", area: "Old GRA", lat: 4.7911, lng: 7.0085,
    photos: P("ext-09", "living-04", "kitchen-06", "bed-05"),
    listing: { title: "4-bedroom bungalow on a large plot in Old GRA", purpose: "SALE", price: "85,000,000", bedrooms: "4", bathrooms: "3", toilets: "4", propertyType: "BUNGALOW", buildingSqm: "260", landSqm: "1100", condition: "GOOD", constructionStatus: "COMPLETED", amenities: ["FENCED", "SECURITY", "GARDEN", "BOREHOLE", "PARKING"], titleDocument: "C_OF_O", negotiable: "yes", description: "Sample listing. Quiet street, mature trees and room to extend." },
    reel: "Old GRA bungalow: garden and living spaces" },
  { company: "ph", agent: 0, name: "3-bedroom flat, Peter Odili Road", category: "Flat", cls: "RESIDENTIAL", city: "Port Harcourt", state: "Rivers", area: "Peter Odili Road", lat: 4.8030, lng: 7.0500,
    photos: P("ext-22", "living-16", "bed-03"),
    listing: { title: "3-bedroom flat in a serviced estate", purpose: "RENT", pricePeriod: "YEAR", price: "3,500,000", bedrooms: "3", bathrooms: "3", toilets: "4", propertyType: "FLAT", condition: "GOOD", amenities: ["GATED", "SECURITY", "GENERATOR", "WATER", "PARKING"], serviceCharge: "600,000", deposit: "350,000", minLeaseMonths: "12", description: "Sample listing. Estate power and water, close to the Trans-Amadi industrial area." } },
  { company: "ph", agent: 0, name: "Office and warehouse, Trans-Amadi", category: "Warehouse", cls: "INDUSTRIAL", city: "Port Harcourt", state: "Rivers", area: "Trans-Amadi", lat: 4.8120, lng: 7.0350,
    photos: P("warehouse-01", "office-01"),
    listing: { title: "Office block with 1,200 m² warehouse yard", purpose: "LEASE", price: "48,000,000", propertyType: "WAREHOUSE", buildingSqm: "1200", landSqm: "3000", condition: "GOOD", amenities: ["FENCED", "SECURITY", "LOADING_BAY", "GENERATOR", "PARKING"], minLeaseMonths: "36", description: "Sample listing. Two-storey offices at the front, a covered warehouse and an open yard for pipe and equipment storage." } },
  // ---------- Ibadan and Enugu ----------
  { company: "west", agent: 0, name: "4-bedroom house, Bodija", category: "House", cls: "RESIDENTIAL", city: "Ibadan", state: "Oyo", area: "Bodija", lat: 7.4290, lng: 3.9150,
    photos: P("ext-06", "living-06", "kitchen-04", "bed-06"),
    listing: { title: "4-bedroom detached house with garden in Bodija", purpose: "SALE", price: "75,000,000", bedrooms: "4", bathrooms: "4", toilets: "5", propertyType: "HOUSE", buildingSqm: "300", landSqm: "700", condition: "RENOVATED", constructionStatus: "COMPLETED", amenities: ["FENCED", "GARDEN", "BOREHOLE", "PARKING", "SECURITY"], titleDocument: "C_OF_O", description: "Sample listing. Recently renovated with a new roof and kitchen, close to the University of Ibadan." } },
  { company: "west", agent: 0, name: "5-bedroom duplex, Enugu", category: "Duplex", cls: "RESIDENTIAL", city: "Enugu", state: "Enugu", area: "Independence Layout", lat: 6.4410, lng: 7.5150,
    photos: P("ext-05", "living-12", "dining-02", "bed-09"),
    listing: { title: "5-bedroom duplex in Independence Layout", purpose: "SALE", price: "120,000,000", bedrooms: "5", bathrooms: "5", toilets: "6", propertyType: "DUPLEX", floors: "2", buildingSqm: "450", landSqm: "900", condition: "NEW", constructionStatus: "COMPLETED", amenities: ["GATED", "SECURITY", "BOYS_QUARTERS", "PARKING", "BOREHOLE", "SOLAR"], titleDocument: "C_OF_O", negotiable: "yes", description: "Sample listing. Hillside views in Enugu's most sought-after layout." },
    reel: "Enugu duplex with hillside views" },
];

/** Reviews left by sample clients after completed deals, so profiles and the home page show what reviews look like. */
export const DEMO_REVIEWS: { company: string; client: string; email: string; overall: number; body: string }[] = [
  { company: "lekki", client: "Bisi Adeyemi", email: "demo.bisi@example.test", overall: 5, body: "Kemi showed us six homes in one Saturday and every one matched what we asked for. The paperwork was ready before we were." },
  { company: "lekki", client: "Femi Ajayi", email: "demo.femi@example.test", overall: 4, body: "Professional from the first call. The short let was exactly like the photos and the check-in was easy." },
  { company: "abuja", client: "Aisha Bello", email: "demo.aisha@example.test", overall: 5, body: "Halima knew every street in Maitama. She told us honestly which houses had power problems, which saved us money." },
  { company: "ph", client: "Tamuno George", email: "demo.tamuno@example.test", overall: 4, body: "Good communication and fair fees. Inspections were always on time." },
  { company: "west", client: "Ngozi Okafor", email: "demo.ngozi@example.test", overall: 5, body: "The payment plan was explained clearly and the house was handed over on the date promised." },
];
