// fields.js
// Single source of truth for the offer sheet and advance sheet fields.
// Loaded by the browser (renders the forms) and required by the server
// (column whitelist, schema, PDF layout), so a field added here shows up
// everywhere at once. New keys also need nothing else: db/init.js adds any
// missing column on startup.

(function (root) {
  // Festival offers: one offer per artist, tagged with the festival so the
  // dashboard can group and filter by it. festivalWide sections are copied
  // when adding another artist to the same festival.
  const OFFER_SECTIONS = [
    { title: 'Festival', festivalWide: true, fields: [
      { key: 'festival_name', label: 'Festival', required: true, type: 'select', options: [], optionsFrom: 'festivals', span2: true }, // options filled from Settings → Festivals
      { key: 'festival_dates', label: 'Festival dates', placeholder: 'e.g. June 12–14, 2027' },
      { key: 'festival_gates', label: 'Gates open', type: 'time' },
      { key: 'festival_presenter', label: 'Presented by' },
      { key: 'festival_contact', label: 'Festival contact', type: 'textarea' },
      { key: 'venue_name', label: 'Festival site / grounds' },
      { key: 'venue_address', label: 'Site address' },
      { key: 'venue_city', label: 'City' },
      { key: 'venue_state', label: 'State' },
      { key: 'capacity', label: 'Expected daily attendance', type: 'number' },
      { key: 'ages', label: 'Ages', type: 'select', options: ['All ages', '18+', '21+'] },
      { key: 'ticket_prices', label: 'Ticket prices (GA / VIP / weekend)' },
      { key: 'announce_date', label: 'Lineup announce date', type: 'date' },
      { key: 'on_sale_date', label: 'On-sale date', type: 'date' },
    ]},
    { title: 'Artist & Agent', fields: [
      { key: 'artist_name', label: 'Artist', required: true },
      { key: 'agency', label: 'Agency' },
      { key: 'agent_name', label: 'Agent' },
      { key: 'agent_email', label: 'Agent email', type: 'email' },
      { key: 'agent_phone', label: 'Agent phone', type: 'tel' },
    ]},
    { title: 'Performance', fields: [
      { key: 'event_date', label: 'Performance date', type: 'date' },
      { key: 'alt_dates', label: 'Alternate days' },
      { key: 'stage', label: 'Stage', type: 'select', options: [], optionsFrom: 'festival_stages' }, // the festival's stages (Settings)
      { key: 'billing', label: 'Lineup position', type: 'select', options: ['Headliner', 'Sub-headliner', 'Main support', 'Mid-card', 'Early slot', 'Local / opener'] },
      { key: 'show_time', label: 'Set time (approx.)', type: 'time' },
      { key: 'set_length', label: 'Set length' },
      { key: 'changeover', label: 'Changeover time' },
      { key: 'poster_billing', label: 'Poster / lineup billing (line, font size %)' },
    ]},
    { title: 'Deal', fields: [
      { key: 'deal_type', label: 'Deal type', type: 'select', options: ['Flat guarantee', 'Guarantee plus bonus', 'Guarantee vs. % of net', 'Guarantee plus % of net'] },
      { key: 'guarantee', label: 'Guarantee', type: 'money' },
      { key: 'percentage', label: 'Back-end % (if any)', type: 'number' },
      { key: 'deposit_amount', label: 'Deposit', type: 'money' },
      { key: 'deposit_due', label: 'Deposit due', type: 'date' },
      { key: 'balance_terms', label: 'Balance terms' },
      { key: 'deal_notes', label: 'Deal notes (bonuses, attendance kickers, expenses)', type: 'textarea', wide: true },
    ]},
    { title: 'Radius & Exclusivity', festivalWide: true, fields: [
      { key: 'radius_clause', label: 'Radius clause (miles / days before & after)', type: 'textarea' },
      { key: 'announce_restrictions', label: 'Announce restrictions / exclusivity', type: 'textarea' },
    ]},
    { title: 'Provided by Festival', festivalWide: true, fields: [
      { key: 'production_provided', label: 'Stage production & backline (shared / line check only)', type: 'textarea' },
      { key: 'hospitality_buyout', label: 'Hospitality / artist village / buyout', type: 'textarea' },
      { key: 'lodging', label: 'Lodging', type: 'textarea' },
      { key: 'ground_transport', label: 'Ground transport / on-site shuttles', type: 'textarea' },
      { key: 'credentials', label: 'Artist credentials / wristbands' },
      { key: 'guest_list_offer', label: 'Guest list allotment' },
      { key: 'artist_parking', label: 'Artist parking (bus / trailer / vans)' },
      { key: 'merch_terms', label: 'Merch (festival merch tent, split)' },
    ]},
    { title: 'Weather, Media & Sponsors', festivalWide: true, fields: [
      { key: 'weather_policy', label: 'Weather / cancellation policy', type: 'textarea' },
      { key: 'media_rights', label: 'Recording, streaming & photo rights', type: 'textarea' },
      { key: 'sponsor_notes', label: 'Sponsor / brand restrictions', type: 'textarea' },
    ]},
    { title: 'Terms', festivalWide: true, fields: [
      { key: 'offer_expires', label: 'Offer expires', type: 'date' },
      { key: 'additional_terms', label: 'Additional terms (printed on the offer sheet)', type: 'textarea', wide: true },
      { key: 'internal_notes', label: 'Internal notes (never printed)', type: 'textarea', wide: true, internal: true },
    ]},
  ];

  const ADVANCE_SECTIONS = [
    // One row per contact (name / phone / email). festivalDefault fields are
    // set once per festival (Settings → Festivals → Details) and fill any
    // blank ones on every advance sheet.
    { title: 'Contacts', columns: 3, fields: [
      { key: 'promoter_rep_name', label: 'Day of Show Contact', festivalDefault: true },
      { key: 'promoter_rep_phone', label: 'Phone', type: 'tel', festivalDefault: true },
      { key: 'promoter_rep_email', label: 'Email', type: 'email', festivalDefault: true },
      { key: 'tour_manager_name', label: 'Tour manager' },
      { key: 'tour_manager_phone', label: 'Phone', type: 'tel' },
      { key: 'tour_manager_email', label: 'Email', type: 'email' },
      { key: 'production_contact_name', label: 'Festival production manager', festivalDefault: true },
      { key: 'production_contact_phone', label: 'Phone', type: 'tel', festivalDefault: true },
      { key: 'production_contact_email', label: 'Email', type: 'email', festivalDefault: true },
      { key: 'stage_manager_name', label: 'Stage manager', festivalDefault: true },
      { key: 'stage_manager_phone', label: 'Phone', type: 'tel', festivalDefault: true },
      { key: 'stage_manager_email', label: 'Email', type: 'email', festivalDefault: true },
      { key: 'artist_relations_name', label: 'Catering / Hospitality', festivalDefault: true },
      { key: 'artist_relations_phone', label: 'Phone', type: 'tel', festivalDefault: true },
      { key: 'artist_relations_email', label: 'Email', type: 'email', festivalDefault: true },
      { key: 'merch_rep_name', label: 'Merchandise', festivalDefault: true },
      { key: 'merch_rep_phone', label: 'Phone', type: 'tel', festivalDefault: true },
      { key: 'merch_rep_email', label: 'Email', type: 'email', festivalDefault: true },
      { key: 'lighting_contact_name', label: 'Lighting', festivalDefault: true },
      { key: 'lighting_contact_phone', label: 'Phone', type: 'tel', festivalDefault: true },
      { key: 'lighting_contact_email', label: 'Email', type: 'email', festivalDefault: true },
      { key: 'sound_contact_name', label: 'Sound', festivalDefault: true },
      { key: 'sound_contact_phone', label: 'Phone', type: 'tel', festivalDefault: true },
      { key: 'sound_contact_email', label: 'Email', type: 'email', festivalDefault: true },
      { key: 'security_contact_name', label: 'Security', festivalDefault: true },
      { key: 'security_contact_phone', label: 'Phone', type: 'tel', festivalDefault: true },
      { key: 'security_contact_email', label: 'Email', type: 'email', festivalDefault: true },
    ]},
    { title: 'Schedule', fields: [
      { key: 'doors_time', label: 'Gates open', type: 'time' },
      { key: 'artist_checkin_time', label: 'Artist arrival', type: 'time' },
      { key: 'load_in_time', label: 'Load in', type: 'time' },
      { key: 'soundcheck_time', label: 'Line check', type: 'time' },
      { key: 'headliner_set_time', label: 'Performance start', type: 'time' },
      { key: 'set_end_time', label: 'Performance stop', type: 'time' },
      { key: 'curfew', label: 'Stage curfew', type: 'time' },
      { key: 'schedule_notes', label: 'Schedule notes (preceding / following acts, changeover)', type: 'textarea', wide: true },
    ]},
    { title: 'Arrival, Credentials & Parking', fields: [
      { key: 'party_size', label: 'Party size', type: 'number' },
      { key: 'vehicles', label: 'Vehicles (bus / trailer / vans)' },
      { key: 'credential_pickup', label: 'Credential / wristband pickup' },
      { key: 'artist_entrance', label: 'Artist entrance / gate' },
      { key: 'parking_notes', label: 'Parking, compound & directions', type: 'textarea', wide: true },
    ]},
    { title: 'Hotel & Travel', fields: [
      { key: 'hotel_name', label: 'Hotel' },
      { key: 'hotel_address', label: 'Hotel address' },
      { key: 'hotel_rooms', label: 'Rooms' },
      { key: 'hotel_confirmation', label: 'Confirmation #' },
      { key: 'hotel_checkin', label: 'Check-in / out' },
      { key: 'ground_transport', label: 'Ground transport / airport runs / golf carts', type: 'textarea', wide: true },
    ]},
    { title: 'Production', fields: [
      { key: 'stage_dimensions', label: 'Stage dimensions' },
      { key: 'power', label: 'Power' },
      { key: 'sound', label: 'Sound', type: 'textarea' },
      { key: 'lights', label: 'Lights', type: 'textarea' },
      { key: 'backline', label: 'Backline', type: 'textarea' },
      { key: 'video', label: 'Video / LED', type: 'textarea' },
    ]},
    { title: 'Hospitality', fields: [
      { key: 'dressing_rooms', label: 'Dressing room / trailer' },
      { key: 'catering', label: 'Catering / artist village', type: 'textarea' },
      { key: 'hospitality_notes', label: 'Rider hospitality notes', type: 'textarea' },
    ]},
    { title: 'Merch, Guests & Settlement', fields: [
      { key: 'merch_seller', label: 'Merch seller', type: 'select', options: ['Artist sells', 'Festival merch tent', 'Third-party vendor'] },
      { key: 'merch_split', label: 'Merch split (soft / hard)' },
      { key: 'guest_list', label: 'Guest list / comps' },
      { key: 'settlement_contact', label: 'Settlement contact' },
      { key: 'payment_method', label: 'Payment method', type: 'select', options: ['Check', 'Wire', 'ACH', 'Cash', 'Company check'] },
      { key: 'wifi_network', label: 'WiFi network' },
      { key: 'wifi_password', label: 'WiFi password' },
      { key: 'advance_notes', label: 'Other notes', type: 'textarea', wide: true },
    ]},
  ];

  const STATUSES = ['draft', 'sent', 'accepted', 'declined', 'cancelled', 'completed'];

  // Payments tab: entered by accounting (or admin/staff). auto ticks the
  // matching checklist item when a date is entered.
  const PAYMENT_SECTIONS = [
    { title: 'Deposit', fields: [
      { key: 'deposit_paid_date', label: 'Deposit paid on', type: 'date', auto: 'pay_deposit' },
      { key: 'deposit_confirmation', label: 'Deposit confirmation #' },
    ]},
    { title: 'Settlement', fields: [
      { key: 'settlement_date', label: 'Settlement completed on', type: 'date', auto: 'pay_settlement' },
      { key: 'settlement_amount', label: 'Final settlement amount', type: 'money' },
      { key: 'settlement_notes', label: 'Settlement notes', type: 'textarea', wide: true },
    ]},
    { title: 'Balance', fields: [
      { key: 'balance_paid_date', label: 'Balance paid on', type: 'date', auto: 'pay_balance' },
      { key: 'balance_confirmation', label: 'Balance confirmation #' },
    ]},
  ];

  // Restricted roles see only accepted/completed shows and only the listed
  // document kinds. Production: advance sheet + riders. Accounting: the offer
  // (read-only), signed contracts, FEC contracts, W-9s, certificates of
  // insurance and the Payments tab.
  const ROLES = { admin: 'Admin', staff: 'Staff', production: 'Production', accounting: 'Accounting' };
  const RESTRICTED_STATUSES = ['accepted', 'completed'];
  const ROLE_DOC_KINDS = {
    production: ['rider_technical', 'rider_hospitality', 'stage_plot'],
    accounting: ['contract', 'fec', 'w9', 'coi'],
  };

  const DOC_KINDS = {
    contract: 'Contract',
    fec: 'FEC contract',
    coi: 'Certificate of insurance',
    rider_technical: 'Technical rider',
    rider_hospitality: 'Hospitality rider',
    stage_plot: 'Stage plot / input list',
    w9: 'W-9',
    other: 'Other',
  };

  // Files attached to every welcome package for a festival (Settings →
  // Festivals → Details & welcome). Runs of show are festival files too
  // (kind 'run_of_show', one per stage per day), matched to each show.
  const WELCOME_FILE_KINDS = {
    audio_specs: 'Audio specs',
    lighting_specs: 'Lighting specs',
    lighting_plot: 'Lighting plot',
    directions: 'Directions',
    grounds_map: 'Festival grounds map',
    other: 'Other',
  };

  const flat = (sections) => sections.flatMap(s => s.fields);
  const api = {
    OFFER_SECTIONS, ADVANCE_SECTIONS, PAYMENT_SECTIONS, STATUSES, DOC_KINDS, ROLES, RESTRICTED_STATUSES, ROLE_DOC_KINDS,
    WELCOME_FILE_KINDS,
    OFFER_FIELDS: flat(OFFER_SECTIONS),
    ADVANCE_FIELDS: flat(ADVANCE_SECTIONS),
    PAYMENT_FIELDS: flat(PAYMENT_SECTIONS),
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PF = api;
})(typeof window !== 'undefined' ? window : this);
