export type SiteNavItem = {
  readonly label: string;
  readonly href: `/${string}`;
};

export type SiteConfig = {
  readonly brand: {
    readonly name: string;
    readonly shortName: string;
    readonly tagline: string;
  };
  readonly navigation: readonly SiteNavItem[];
  readonly links: {
    readonly repository: `https://${string}`;
    readonly sponsor: `/${string}` | `https://${string}`;
  };
  readonly metadata: {
    readonly defaultTitle: string;
    readonly titleTemplate: `${string}%s${string}`;
    readonly description: string;
    readonly locale: `${string}_${string}`;
    readonly socialImage: {
      readonly src: `/${string}`;
      readonly alt: string;
      readonly width: number;
      readonly height: number;
      readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    };
    readonly twitterCard: 'summary' | 'summary_large_image';
  };
  /**
   * Set this once a production domain exists. Until then, the layout deliberately
   * omits absolute canonical and social image URLs.
   */
  readonly siteUrl: `https://${string}` | null;
};

export const siteConfig = {
  brand: {
    name: 'Ultra Agentic',
    shortName: 'UA',
    tagline: 'Composable tools for capable agents',
  },
  navigation: [
    { label: 'Catalog', href: '/catalog/' },
    { label: 'Blog', href: '/blog/' },
    { label: 'Get started', href: '/get-started/' },
    { label: 'Sponsors', href: '/sponsors/' },
    { label: 'About', href: '/about/' },
  ],
  links: {
    repository: 'https://github.com/deirs/ultra-agentic',
    sponsor: '/sponsors/',
  },
  metadata: {
    defaultTitle: 'Ultra Agentic — Composable tools for capable agents',
    titleTemplate: '%s — Ultra Agentic',
    description:
      'A transparent catalog of MCP servers, agent skills, and datasets designed for composable AI workflows.',
    locale: 'en_US',
    socialImage: {
      src: '/social-card.png',
      alt: 'Ultra Agentic connector diagram linking MCP servers, skills, and datasets.',
      width: 1200,
      height: 630,
      mimeType: 'image/png',
    },
    twitterCard: 'summary_large_image',
  },
  siteUrl: null,
} as const satisfies SiteConfig;
