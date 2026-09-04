/**
 * Seed content for the demo clinic.
 *
 * Everything goes in through the **Local API** (`runtime.create`) rather than the raw database
 * adapter, so seeded rows run the same validation, hooks and draft handling a real editor's write
 * would — which is also how spec 019 intends server-side code to talk to the CMS.
 */
import type { ForgeCmsRuntime } from '@forge-cms/runtime';
import type { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import type { RichTextContent } from '@forge-cms/core';

export const DEMO_ADMIN = { email: 'demo@lumea.clinic', password: 'lumea-demo' };
export const DEMO_EDITOR = { email: 'frontdesk@lumea.clinic', password: 'lumea-desk' };

/** Minimal richtext helper — a paragraph list. There is no editor for this kind yet (finding 7). */
function paragraphs(...texts: string[]): RichTextContent {
  return texts.map((text) => ({ type: 'paragraph', children: [{ type: 'text', text }] }));
}

function daysFromNow(days: number, hour = 10): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

interface SeedIds {
  categories: Record<string, string>;
  services: Record<string, string>;
  staff: Record<string, string>;
  media: Record<string, string>;
}

export async function seedContent(runtime: ForgeCmsRuntime): Promise<void> {
  const auth = runtime.adapters.auth as UsersCollectionAuthAdapter;

  await auth.createUser({
    email: DEMO_ADMIN.email,
    password: DEMO_ADMIN.password,
    name: 'Elena Marchetti',
    role: 'admin'
  });
  await auth.createUser({
    email: DEMO_EDITOR.email,
    password: DEMO_EDITOR.password,
    name: 'Front desk',
    role: 'editor'
  });

  const ids: SeedIds = { categories: {}, services: {}, staff: {}, media: {} };

  await seedMedia(runtime, ids);
  await seedCategories(runtime, ids);
  await seedServices(runtime, ids);
  await seedStaff(runtime, ids);
  await seedTestimonials(runtime, ids);
  await seedPromotions(runtime, ids);
  await seedPosts(runtime, ids);
  await seedBookings(runtime, ids);
  await seedPages(runtime);
  await seedSettings(runtime);
}

async function seedMedia(runtime: ForgeCmsRuntime, ids: SeedIds): Promise<void> {
  const files = [
    { key: 'facial', filename: 'signature-facial.svg', alt: 'A facial treatment in progress' },
    { key: 'laser', filename: 'laser.svg', alt: 'Laser handpiece on a treatment couch' },
    { key: 'body', filename: 'body.svg', alt: 'Body contouring room' },
    { key: 'clinic', filename: 'clinic.svg', alt: 'The clinic reception' },
    { key: 'elena', filename: 'team-elena.svg', alt: 'Portrait of Dr. Elena Marchetti' },
    { key: 'sofia', filename: 'team-sofia.svg', alt: 'Portrait of Sofia Rey' },
    { key: 'nadia', filename: 'team-nadia.svg', alt: 'Portrait of Nadia Kern' },
    { key: 'journal-spf', filename: 'journal-spf.svg', alt: 'Sunscreen on a linen background' },
    { key: 'journal-peel', filename: 'journal-peel.svg', alt: 'Chemical peel preparation' }
  ];

  for (const file of files) {
    const doc = await runtime.create({
      collection: 'media',
      data: {
        filename: file.filename,
        alt: file.alt,
        // Seeded media points at static files in `public/images` — no bytes go through the storage
        // adapter here. The real multipart path is exercised by /admin/media.
        url: `/images/${file.filename}`,
        contentType: 'image/svg+xml',
        filesize: 0,
        credit: 'Lumea Aesthetics'
      }
    });
    ids.media[file.key] = String(doc.id);
  }
}

async function seedCategories(runtime: ForgeCmsRuntime, ids: SeedIds): Promise<void> {
  const categories = [
    {
      key: 'facials',
      name: 'Facials',
      tagline: 'Skin health, session by session',
      description:
        'Deep-cleansing, hydrating and resurfacing protocols built around your skin type.',
      order: 1
    },
    {
      key: 'advanced',
      name: 'Advanced skin',
      tagline: 'Clinical results, medically supervised',
      description: 'Microneedling, peels and injectables performed by our medical team.',
      order: 2
    },
    {
      key: 'laser',
      name: 'Laser & light',
      tagline: 'Hair removal and pigmentation',
      description: 'Diode and IPL platforms for hair reduction, redness and sun damage.',
      order: 3
    },
    {
      key: 'body',
      name: 'Body & wellness',
      tagline: 'Contour, circulation, recovery',
      description: 'Contouring, lymphatic drainage and massage for the whole body.',
      order: 4
    }
  ];

  for (const category of categories) {
    const doc = await runtime.create({
      collection: 'service_categories',
      data: {
        name: category.name,
        tagline: category.tagline,
        description: category.description,
        order: category.order
      }
    });
    ids.categories[category.key] = String(doc.id);
  }
}

async function seedServices(runtime: ForgeCmsRuntime, ids: SeedIds): Promise<void> {
  const services = [
    {
      key: 'hydraglow',
      name: 'Signature HydraGlow facial',
      category: 'facials',
      summary:
        'A 60-minute deep-cleanse, exfoliation and hydration protocol that leaves skin calm and luminous.',
      description: paragraphs(
        'Our most-booked treatment. We start with a double cleanse and a gentle enzymatic exfoliation, then move to vortex extraction and a hyaluronic infusion tailored to your skin reading.',
        'There is no downtime: most clients book it the same week as an event.'
      ),
      durationMinutes: 60,
      price: 95,
      priceNote: 'per session · packs of 4 available',
      image: 'facial',
      featured: true,
      order: 1,
      benefits: [
        {
          title: 'Immediate glow',
          detail: 'Visible hydration and even tone from the first session.'
        },
        { title: 'No downtime', detail: 'Return to normal activity straight after.' },
        {
          title: 'Every skin type',
          detail: 'Actives are chosen after a skin reading, not by protocol.'
        }
      ],
      faqs: [
        {
          question: 'How often should I book it?',
          answer:
            'Every four to six weeks keeps results steady; monthly during winter if your skin is dry.'
        },
        {
          question: 'Can I wear make-up afterwards?',
          answer: 'Yes, though we suggest waiting a couple of hours so the serums settle.'
        }
      ],
      aftercare: {
        downtimeDays: 0,
        instructions: 'Use SPF 50 for the next 48 hours and skip retinoids for two nights.',
        sessionsRecommended: 4
      }
    },
    {
      key: 'microneedling',
      name: 'Microneedling with growth factors',
      category: 'advanced',
      summary:
        'Collagen induction therapy for scarring, texture and fine lines, performed by our medical team.',
      description: paragraphs(
        'A medical-grade pen creates controlled micro-channels that trigger your own collagen response, followed by a growth-factor serum applied under occlusion.',
        'Expect redness for 24 to 48 hours. Results build over three sessions spaced a month apart.'
      ),
      durationMinutes: 75,
      price: 180,
      priceNote: 'per session · course of 3 recommended',
      image: 'clinic',
      featured: true,
      order: 2,
      benefits: [
        { title: 'Texture and scarring', detail: 'The reference treatment for post-acne marks.' },
        {
          title: 'Collagen, not filler',
          detail: 'Stimulates your own tissue rather than adding volume.'
        }
      ],
      faqs: [
        {
          question: 'Is it painful?',
          answer:
            'Topical anaesthetic is applied for 30 minutes beforehand; most clients describe it as a strong vibration.'
        }
      ],
      aftercare: {
        downtimeDays: 2,
        instructions: 'No make-up for 24 hours, no gym for 48, SPF 50 daily for two weeks.',
        sessionsRecommended: 3
      }
    },
    {
      key: 'laser-hair',
      name: 'Laser hair removal — medium area',
      category: 'laser',
      summary: 'Diode laser hair reduction for underarms, bikini line or lower face.',
      description: paragraphs(
        'A cooled diode platform that is safe on most skin tones. Hair is reduced progressively over six to eight sessions spaced four to six weeks apart.'
      ),
      durationMinutes: 30,
      price: 65,
      priceNote: 'per area, per session',
      image: 'laser',
      featured: true,
      order: 3,
      benefits: [
        { title: 'Progressive reduction', detail: 'Around 80% less hair after a full course.' },
        {
          title: 'Comfort-cooled',
          detail: 'Contact cooling makes the pulse tolerable without gel packs.'
        }
      ],
      faqs: [
        {
          question: 'Can I come with a tan?',
          answer: 'No. We need two weeks with no sun exposure or self-tanner before a session.'
        }
      ],
      aftercare: {
        downtimeDays: 0,
        instructions:
          'Avoid heat, sauna and sun for 48 hours. Do not wax between sessions — shave only.',
        sessionsRecommended: 6
      }
    },
    {
      key: 'peel',
      name: 'Medium-depth chemical peel',
      category: 'advanced',
      summary: 'A targeted resurfacing peel for pigmentation, dullness and sun damage.',
      description: paragraphs(
        'We combine mandelic and salicylic acids at a concentration chosen from your skin history. Flaking starts around day three and settles by day six.'
      ),
      durationMinutes: 45,
      price: 130,
      image: 'facial',
      featured: false,
      order: 4,
      benefits: [{ title: 'Pigmentation', detail: 'Fades sun spots and post-inflammatory marks.' }],
      faqs: [],
      aftercare: {
        downtimeDays: 5,
        instructions: 'Do not pick the flaking skin. SPF 50 every two hours outdoors.',
        sessionsRecommended: 3
      }
    },
    {
      key: 'radiofrequency',
      name: 'Radiofrequency body contouring',
      category: 'body',
      summary: 'Deep-heating radiofrequency for abdomen, flanks or thighs.',
      description: paragraphs(
        'Controlled dermal heating tightens tissue and improves the appearance of cellulite. Best combined with lymphatic drainage in the same week.'
      ),
      durationMinutes: 50,
      price: 110,
      priceNote: 'per area',
      image: 'body',
      featured: false,
      order: 5,
      benefits: [{ title: 'Firmness', detail: 'Visible tightening after four sessions.' }],
      faqs: [],
      aftercare: {
        downtimeDays: 0,
        instructions: 'Drink water generously for 24 hours to support drainage.',
        sessionsRecommended: 6
      }
    },
    {
      key: 'lymphatic',
      name: 'Lymphatic drainage massage',
      category: 'body',
      summary:
        'A manual technique that reduces fluid retention and speeds up post-treatment recovery.',
      description: paragraphs(
        'Slow, rhythmic manual drainage along the lymphatic pathways. Frequently booked after surgery or contouring sessions.'
      ),
      durationMinutes: 60,
      price: 75,
      image: 'body',
      featured: false,
      order: 6,
      benefits: [{ title: 'Lightness', detail: 'Immediate relief from heavy legs and puffiness.' }],
      faqs: [],
      aftercare: {
        downtimeDays: 0,
        instructions: 'Walk for twenty minutes afterwards if you can.',
        sessionsRecommended: 4
      }
    },
    {
      key: 'led',
      name: 'LED light therapy add-on',
      category: 'facials',
      summary: 'Fifteen minutes of red or blue light to calm inflammation or target acne bacteria.',
      description: paragraphs(
        'Added to any facial. Red light for redness and repair, blue for active breakouts.'
      ),
      durationMinutes: 15,
      price: 25,
      priceNote: 'add-on to any facial',
      image: 'facial',
      featured: false,
      order: 7,
      benefits: [{ title: 'Calming', detail: 'Reduces post-treatment redness noticeably.' }],
      faqs: [],
      aftercare: { downtimeDays: 0, instructions: 'None.', sessionsRecommended: 6 }
    }
  ];

  for (const service of services) {
    const doc = await runtime.create({
      collection: 'services',
      data: {
        name: service.name,
        category: ids.categories[service.category],
        summary: service.summary,
        description: service.description,
        durationMinutes: service.durationMinutes,
        price: service.price,
        ...(service.priceNote !== undefined && { priceNote: service.priceNote }),
        image: ids.media[service.image],
        featured: service.featured,
        order: service.order,
        benefits: service.benefits,
        faqs: service.faqs,
        aftercare: service.aftercare,
        _status: 'published'
      }
    });
    ids.services[service.key] = String(doc.id);
  }

  // A treatment still being written: proves drafts are invisible to the public site.
  await runtime.create({
    collection: 'services',
    data: {
      name: 'Bridal glow programme',
      category: ids.categories.facials,
      summary: 'A three-month plan timed to the wedding date. Pricing still being finalised.',
      durationMinutes: 90,
      price: 0,
      featured: false,
      order: 99,
      _status: 'draft'
    }
  });
}

async function seedStaff(runtime: ForgeCmsRuntime, ids: SeedIds): Promise<void> {
  const team = [
    {
      key: 'elena',
      name: 'Dr. Elena Marchetti',
      jobTitle: 'Medical director',
      bio: 'Dermatologist with fifteen years in aesthetic medicine. Leads every injectable and medical-grade protocol at Lumea.',
      photo: 'elena',
      specialties: ['microneedling', 'peel'],
      credentials: [
        { title: 'MD, Dermatology', issuer: 'Università di Bologna', year: 2009 },
        { title: 'Aesthetic medicine fellowship', issuer: 'SEME', year: 2013 }
      ],
      socials: { instagram: 'https://instagram.com/lumea.clinic', linkedin: '' },
      order: 1
    },
    {
      key: 'sofia',
      name: 'Sofia Rey',
      jobTitle: 'Senior aesthetician',
      bio: 'Facial specialist. Built the HydraGlow protocol and trains the rest of the team on skin reading.',
      photo: 'sofia',
      specialties: ['hydraglow', 'led'],
      credentials: [{ title: 'Advanced facial therapy', issuer: 'CIDESCO', year: 2016 }],
      socials: { instagram: 'https://instagram.com/lumea.clinic', linkedin: '' },
      order: 2
    },
    {
      key: 'nadia',
      name: 'Nadia Kern',
      jobTitle: 'Laser & body specialist',
      bio: 'Runs the laser and contouring rooms. Certified on diode, IPL and radiofrequency platforms.',
      photo: 'nadia',
      specialties: ['laser-hair', 'radiofrequency', 'lymphatic'],
      credentials: [{ title: 'Laser safety officer', issuer: 'BMLA', year: 2019 }],
      socials: { instagram: '', linkedin: '' },
      order: 3
    }
  ];

  for (const member of team) {
    const doc = await runtime.create({
      collection: 'staff',
      data: {
        name: member.name,
        jobTitle: member.jobTitle,
        bio: member.bio,
        photo: ids.media[member.photo],
        specialties: member.specialties
          .map((key) => ids.services[key])
          .filter((id): id is string => id !== undefined),
        credentials: member.credentials,
        socials: member.socials,
        order: member.order,
        active: true
      }
    });
    ids.staff[member.key] = String(doc.id);
  }
}

async function seedTestimonials(runtime: ForgeCmsRuntime, ids: SeedIds): Promise<void> {
  const testimonials = [
    {
      author: 'Marta L.',
      quote:
        'Three sessions of microneedling did what two years of creams could not. Dr. Marchetti explained every step before touching my skin.',
      rating: 5,
      service: 'microneedling',
      visitedAt: daysFromNow(-42),
      status: 'published' as const
    },
    {
      author: 'Carla R.',
      quote:
        'I book the HydraGlow before anything important. It is the only facial that never leaves me red.',
      rating: 5,
      service: 'hydraglow',
      visitedAt: daysFromNow(-20),
      status: 'published' as const
    },
    {
      author: 'Inés B.',
      quote: 'Laser sessions run exactly on time, which matters when you come on a lunch break.',
      rating: 4,
      service: 'laser-hair',
      visitedAt: daysFromNow(-11),
      status: 'published' as const
    },
    {
      author: 'Anonymous',
      quote: 'Waiting to see how the last session settles before I say anything.',
      rating: 3,
      service: 'peel',
      visitedAt: daysFromNow(-2),
      status: 'draft' as const
    }
  ];

  for (const testimonial of testimonials) {
    await runtime.create({
      collection: 'testimonials',
      data: {
        author: testimonial.author,
        quote: testimonial.quote,
        rating: testimonial.rating,
        service: ids.services[testimonial.service],
        visitedAt: testimonial.visitedAt,
        _status: testimonial.status
      }
    });
  }
}

async function seedPromotions(runtime: ForgeCmsRuntime, ids: SeedIds): Promise<void> {
  await runtime.create({
    collection: 'promotions',
    data: {
      title: 'Spring skin reset',
      description:
        'Book a course of three HydraGlow facials and the third is half price until the end of the season.',
      discountPercent: 17,
      code: 'SPRINGGLOW',
      services: [ids.services.hydraglow].filter((id): id is string => id !== undefined),
      validFrom: daysFromNow(-14),
      validUntil: daysFromNow(45),
      active: true
    }
  });

  await runtime.create({
    collection: 'promotions',
    data: {
      title: 'Black Friday — laser packs',
      description: 'Draft campaign for November. Not visible on the site until it is switched on.',
      discountPercent: 30,
      code: 'BF30',
      services: [ids.services['laser-hair']].filter((id): id is string => id !== undefined),
      active: false
    }
  });
}

async function seedPosts(runtime: ForgeCmsRuntime, ids: SeedIds): Promise<void> {
  await runtime.create({
    collection: 'posts',
    data: {
      title: 'The only two products your morning routine actually needs',
      excerpt:
        'Most clients arrive with eleven products and dehydrated skin. Here is what earns its place in the morning.',
      body: paragraphs(
        'If we could keep two things in your morning routine, it would be a well-formulated antioxidant and a sunscreen you will genuinely reapply.',
        'Everything else — essences, mists, the third serum — is optional, and often the reason a barrier is struggling in the first place.',
        'Start with a vitamin C at 10 to 15 percent, give it three months, and judge the result against a photograph rather than a memory.'
      ),
      coverImage: ids.media['journal-spf'],
      author: ids.staff.sofia,
      topic: 'skin',
      publishedAt: daysFromNow(-9),
      _status: 'published'
    }
  });

  await runtime.create({
    collection: 'posts',
    data: {
      title: 'What a medium-depth peel actually feels like, day by day',
      excerpt: 'An honest week of photographs and what to expect on each of them.',
      body: paragraphs(
        'Day one is tight and slightly pink. Day two the skin starts to feel like cardboard — this is normal and it is not the result.',
        'Day three to five is the flaking phase. Do not help it along: pulling at the sheets of skin is how you end up with a mark that lasts months.',
        'By day six most people are back to normal, with a noticeably brighter tone that keeps improving for a fortnight.'
      ),
      coverImage: ids.media['journal-peel'],
      author: ids.staff.elena,
      topic: 'skin',
      publishedAt: daysFromNow(-25),
      _status: 'published'
    }
  });

  await runtime.create({
    collection: 'posts',
    data: {
      title: 'We are extending Thursday evening hours',
      excerpt: 'From next month the clinic stays open until 21:00 on Thursdays.',
      body: paragraphs('Draft announcement — waiting on the final rota before this goes live.'),
      author: ids.staff.elena,
      topic: 'clinic news',
      _status: 'draft'
    }
  });
}

async function seedBookings(runtime: ForgeCmsRuntime, ids: SeedIds): Promise<void> {
  await runtime.create({
    collection: 'bookings',
    data: {
      name: 'Lucía Fernández',
      email: 'lucia@example.com',
      phone: '+34 600 111 222',
      service: ids.services.hydraglow,
      preferredDate: daysFromNow(3, 17),
      notes: 'First visit. Sensitive skin, reacts to fragrance.',
      status: 'confirmed',
      internalNotes: 'Patch test done on arrival — fine.',
      source: 'website'
    }
  });

  await runtime.create({
    collection: 'bookings',
    data: {
      name: 'Andrés Gil',
      email: 'andres@example.com',
      phone: '+34 655 987 654',
      service: ids.services['laser-hair'],
      preferredDate: daysFromNow(6, 11),
      notes: 'Asked whether a course of six can be paid monthly.',
      status: 'pending',
      source: 'website'
    }
  });
}

async function seedPages(runtime: ForgeCmsRuntime): Promise<void> {
  await runtime.create({
    collection: 'pages',
    data: {
      title: 'Home',
      slug: 'home',
      seo: {
        metaTitle: 'Lumea Aesthetics — skin and body clinic',
        metaDescription:
          'A medically supervised skin and body clinic. Facials, laser, microneedling and body treatments, by appointment.',
        noIndex: false
      },
      sections: [
        {
          blockType: 'hero',
          eyebrow: 'Skin & body clinic',
          heading: 'Treatments that answer to your skin, not to a menu',
          subheading:
            'Every plan starts with a skin reading and a conversation about what you actually want to change. Medically supervised, no packages you did not ask for.',
          primaryCtaLabel: 'Book a consultation',
          primaryCtaHref: '/booking',
          secondaryCtaLabel: 'See treatments',
          secondaryCtaHref: '/services'
        },
        {
          blockType: 'stat_band',
          stats: [
            { value: '12 yrs', label: 'Caring for skin in the neighbourhood' },
            { value: '4.9/5', label: 'Average client rating' },
            { value: '2,400+', label: 'Treatments a year' },
            { value: '48 h', label: 'Typical wait for an appointment' }
          ]
        },
        {
          blockType: 'featured_services',
          heading: 'Most booked this season',
          intro:
            'Three treatments that make up most of our diary — and the ones we are asked about most.',
          limit: 3
        },
        {
          blockType: 'rich_text',
          heading: 'How a first visit works',
          body: 'You arrive twenty minutes early, we read your skin under magnification and talk through what has and has not worked before. You leave with a plan and a written price, whether or not you book anything on the day.',
          align: 'left'
        },
        {
          blockType: 'testimonials',
          heading: 'What clients say',
          limit: 3
        },
        {
          blockType: 'cta',
          heading: 'Ready when you are',
          body: 'Consultations are free and last about thirty minutes. No obligation to book a treatment afterwards.',
          ctaLabel: 'Request an appointment',
          ctaHref: '/booking'
        }
      ],
      _status: 'published'
    }
  });
}

async function seedSettings(runtime: ForgeCmsRuntime): Promise<void> {
  await runtime.create({
    collection: 'site_settings',
    data: {
      clinicName: 'Lumea Aesthetics',
      tagline: 'Skin and body, medically supervised',
      about:
        'Lumea is a small clinic run by a dermatologist and two specialists. We treat skin conditions and aesthetic concerns with the same protocol: read the skin, agree a plan, review the result.',
      phone: '+34 910 000 000',
      email: 'hola@lumea.clinic',
      bookingEmail: 'citas@lumea.clinic',
      address: {
        street: 'Calle del Prado 18',
        city: 'Madrid',
        postalCode: '28014',
        mapUrl: 'https://maps.example.com/lumea'
      },
      openingHours: [
        { day: 'Monday', opens: '10:00', closes: '20:00', closed: false },
        { day: 'Tuesday', opens: '10:00', closes: '20:00', closed: false },
        { day: 'Wednesday', opens: '10:00', closes: '20:00', closed: false },
        { day: 'Thursday', opens: '10:00', closes: '21:00', closed: false },
        { day: 'Friday', opens: '10:00', closes: '19:00', closed: false },
        { day: 'Saturday', opens: '10:00', closes: '14:00', closed: false },
        { day: 'Sunday', opens: '', closes: '', closed: true }
      ],
      socials: {
        instagram: 'https://instagram.com/lumea.clinic',
        facebook: '',
        tiktok: ''
      }
    }
  });
}
