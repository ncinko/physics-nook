export interface ExternalResource {
  title: string;
  description: string;
  href: string;
}

export interface ExternalResourceGroup {
  id: string;
  label: string;
  resources: ExternalResource[];
}

export const externalResourceGroups: ExternalResourceGroup[] = [
  {
    id: 'videos',
    label: 'Videos',
    resources: [
      {
        title: 'The Organic Chemistry Tutor',
        description:
          'Methodical problem-solving walkthroughs across the full intro physics curriculum.',
        href: 'https://www.youtube.com/watch?v=b1t41Q3xRM8&list=PL0o_zxa4K1BU6wPPLDsoTj1_wEf0LSNeR',
      },
      {
        title: 'MIT OpenCourseWare',
        description:
          'Full recorded MIT lectures for a proper, classroom-paced treatment of the material.',
        href: 'https://www.youtube.com/watch?v=wWnfJ0-xXRE&list=PLyQSN7X0ro203puVhQsmCj9qhlFQ-As8e',
      },
    ],
  },
  {
    id: 'text',
    label: 'Text',
    resources: [
      {
        title: 'OpenStax University Physics',
        description:
          'A free, peer-reviewed, calculus-based textbook covering the standard two/three-semester sequence.',
        href: 'https://openstax.org/books/university-physics-volume-1/pages/1-introduction',
      },
      {
        title: 'The Feynman Lectures on Physics',
        description:
          "The classic lectures, free to read online.",
        href: 'https://www.feynmanlectures.caltech.edu/',
      },
    ],
  },
  {
    id: 'simulators',
    label: 'Simulators',
    resources: [
      {
        title: "Falstad's Applets",
        description:
          "Paul Falstad's browser-based simulators for circuits, waves, and more. This site's own Ripple Tank was directly inspired by Falstad's ripple simulator.",
        href: 'https://www.falstad.com/mathphysics.html',
      },
      {
        title: 'PhET Simulations',
        description:
          "University of Colorado Boulder's simulations covering the full intro physics curriculum.",
        href: 'https://phet.colorado.edu/',
      },
    ],
  },
];
