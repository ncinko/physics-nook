import type { PageMeta } from './site';
import { homePageMeta, standalonePages } from './site';
import { normalizePath } from '../utils/paths';

export type ModuleStatus = 'flagship' | 'active';
export type ModuleNavVisibility = 'menu' | 'hidden';

export interface ModulePage {
  id: string;
  href: string;
  title: string;
  shortTitle?: string;
  description: string;
  seo: PageMeta;
}

export interface ModuleMeta {
  slug: string;
  href: string;
  title: string;
  navLabel: string;
  summary: string;
  audience: string;
  prerequisites: string[];
  learningObjectives: string[];
  status: ModuleStatus;
  navVisibility: ModuleNavVisibility;
  cardEyebrow: string;
  accent: string;
  heroImage: string;
  featured?: boolean;
  pages: ModulePage[];
}

export interface ModulePathGroup {
  id: string;
  href: string;
  navLabel: string;
  summary: string;
  cardEyebrow: string;
  navVisibility: ModuleNavVisibility;
  pages: ModulePage[];
}

export const modules: ModuleMeta[] = [
  {
    slug: 'math',
    href: '/math/vectors',
    title: 'Math Foundations',
    navLabel: 'Math',
    summary:
      'Vector interpretation, components, and operations for physics problem solving.',
    audience: 'Self-learners preparing for mechanics, free-body diagrams, and two-dimensional motion.',
    prerequisites: ['Signed numbers', 'Coordinate axes', 'Basic algebra'],
    learningObjectives: [
      'Interpret vectors as quantities with both magnitude and direction',
      'Read and write two-dimensional vectors using components',
      'Connect graphical head-to-tail addition to symbolic component addition',
      'Scale and negate vectors and read the effect on magnitude and direction',
      'Express vectors with unit vectors and connect the formalism to physical units',
    ],
    status: 'active',
    navVisibility: 'menu',
    cardEyebrow: 'Math tools',
    accent: '#0f766e',
    heroImage: '/social/physics-nook-card.svg',
    pages: [
      {
        id: 'math-vectors',
        href: '/math/vectors',
        title: 'Vectors',
        description:
          'Learn to read vectors by their components, magnitude, and direction, and to add them head-to-tail, starting from hops on a number line.',
        seo: {
          title: 'Vectors',
          description:
            'Learn how to read vectors by components, magnitude, and direction, and add them head-to-tail — building up from a bunny hopping on a number line.',
          canonicalPath: '/math/vectors',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'math-more-vectors',
        href: '/math/more-vectors',
        title: 'More with Vectors',
        shortTitle: 'More Vectors',
        description:
          'Scale and negate vectors, build them from unit vectors, and see how the same formalism carries physical units.',
        seo: {
          title: 'More with Vectors',
          description:
            'Scale and negate vectors, write them with unit vectors, and connect displacement, velocity, and force through the units a vector carries.',
          canonicalPath: '/math/more-vectors',
          image: '/social/physics-nook-card.svg',
        },
      },
    ],
  },
  {
    slug: 'kinematics',
    href: '/kinematics',
    title: '1D Kinematics',
    navLabel: 'Kinematics',
    summary:
      'Position, velocity, acceleration, graph slopes, vector components, and motion challenges.',
    audience: 'Self-learners building a first mechanics foundation.',
    prerequisites: ['Graph reading', 'Signed numbers', 'Basic algebra with ratios'],
    learningObjectives: [
      'Interpret signed position, velocity, and acceleration in one dimension',
      'Connect average and instantaneous velocity to slopes on a position-time graph',
      'Connect acceleration to changes in velocity over time',
      'Use acceleration controls to solve a stop-in-zones motion challenge',
      'Break two-dimensional motion into horizontal and vertical components',
    ],
    status: 'active',
    navVisibility: 'hidden',
    cardEyebrow: 'Mechanics',
    accent: '#0f766e',
    heroImage: '/social/physics-nook-card.svg',
    pages: [
      {
        id: 'kinematics-core',
        href: '/kinematics',
        title: '1D Kinematics',
        shortTitle: '1D Motion',
        description:
          'Learn position, velocity, and acceleration through graph slopes and a stop-in-zones challenge.',
        seo: {
          title: '1D Kinematics',
          description:
            'Learn one-dimensional kinematics with interactive position and velocity graphs plus a stop-in-zones acceleration challenge.',
          canonicalPath: '/kinematics',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'kinematics-2d',
        href: '/kinematics/two-dimensional',
        title: '2D Kinematics',
        shortTitle: '2D Motion',
        description:
          'Extend kinematics into vector components, projectile motion, and two-dimensional acceleration.',
        seo: {
          title: '2D Kinematics',
          description:
            'Learn two-dimensional kinematics with vector components, projectile motion, and interactive acceleration sandboxes.',
          canonicalPath: '/kinematics/two-dimensional',
          image: '/social/physics-nook-card.svg',
        },
      },
    ],
  },
  {
    slug: 'relativity',
    href: '/relativity',
    title: 'Relativity',
    navLabel: 'Relativity',
    summary:
      'Spacetime diagrams, Lorentz transformations, relativistic energy & momentum, and general relativity.',
    audience: 'Self-learners building intuition before or alongside a formal course.',
    prerequisites: [
      'Comfort reading graphs and coordinate axes',
      'Basic algebra with square roots and ratios',
      'Familiarity with velocity, momentum, and energy in classical mechanics',
    ],
    learningObjectives: [
      'Read spacetime diagrams and explain why simultaneity depends on the observer',
      'Derive and use the Lorentz transformations for one-dimensional inertial motion',
      'Connect beta, gamma, momentum, and energy in one-dimensional special relativity',
      'Describe gravity geometrically through the equivalence principle and geodesics',
    ],
    status: 'flagship',
    navVisibility: 'menu',
    cardEyebrow: 'Relativity',
    accent: '#3b82f6',
    heroImage: '/social/relativity-card.svg',
    featured: true,
    pages: [
      {
        id: 'spacetime-diagrams',
        href: '/relativity',
        title: 'Spacetime Diagrams',
        shortTitle: 'Spacetime',
        description:
          'Events, worldlines, and a geometric interpretation of space & time.',
        seo: {
          title: 'Relativity',
          description:
            'Start the relativity path with spacetime diagrams, worldlines, light cones, and relativity of simultaneity.',
          canonicalPath: '/relativity',
          image: '/social/relativity-card.svg',
        },
      },
      {
        id: 'lorentz-transformations',
        href: '/relativity/lorentz-transformations',
        title: 'Lorentz Transformations',
        shortTitle: 'Lorentz',
        description:
          'Derive the coordinate transformations that preserve the speed of light for every inertial observer.',
        seo: {
          title: 'Lorentz Transformations',
          description:
            'Derive the Lorentz transformations algebraically from the constancy of the speed of light and use them to compare events between inertial frames.',
          canonicalPath: '/relativity/lorentz-transformations',
          image: '/social/relativity-card.svg',
        },
      },
      {
        id: 'momentum-energy',
        href: '/relativity/momentum-energy',
        title: 'Relativistic Momentum and Energy',
        shortTitle: 'Momentum and Energy',
        description:
          'See how momentum and energy transform near the speed of light.',
        seo: {
          title: 'Relativistic Momentum and Energy',
          description:
            'Compare classical and relativistic momentum and energy with a guided one-dimensional explorer.',
          canonicalPath: '/relativity/momentum-energy',
          image: '/social/relativity-card.svg',
        },
      },
      {
        id: 'general-relativity',
        href: '/relativity/general-relativity',
        title: 'General Relativity',
        shortTitle: 'General Relativity',
        description:
          'Connect accelerating frames to gravity through the equivalence principle, and move beyond flat spacetime.',
        seo: {
          title: 'General Relativity',
          description:
            'Explore the equivalence principle, geodesics, and tidal gravity through an interactive introduction to general relativity.',
          canonicalPath: '/relativity/general-relativity',
          image: '/social/relativity-card.svg',
        },
      },
    ],
  },
  {
    slug: 'oscillations',
    href: '/oscillations',
    title: 'Oscillations',
    navLabel: 'Oscillations',
    summary:
      'Explore springs, pendulums, and coupled resonance through sinusoidal motion, restoring forces, and energy exchange.',
    audience: 'Self-learners reinforcing the language of periodic motion.',
    prerequisites: ['Basic force diagrams', 'Algebra', 'Graphs of sine and cosine'],
    learningObjectives: [
      'Connect restoring force to simple harmonic motion',
      'Relate period, frequency, angular frequency, and resonant driving',
      'Track the energy exchange within one oscillator and between coupled neighbors',
      'Use coupled oscillators as a bridge from periodic motion to waves',
    ],
    status: 'active',
    navVisibility: 'menu',
    cardEyebrow: 'Core module',
    accent: '#0f766e',
    heroImage: '/social/physics-nook-card.svg',
    pages: [
      {
        id: 'oscillations-core',
        href: '/oscillations',
        title: 'Oscillations',
        description:
          'Use springs and pendulums to connect equilibrium, sinusoidal motion, and energy exchange.',
        seo: {
          title: 'Oscillations',
          description:
            'Learn simple harmonic motion through restoring forces, sinusoidal motion, and a spring-mass explorer.',
          canonicalPath: '/oscillations',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'oscillations-resonance',
        href: '/oscillations/resonance',
        title: 'Resonance',
        description:
          'Use coupled oscillators to connect driven resonance, normal modes, and the first hints of wave motion.',
        seo: {
          title: 'Resonance',
          description:
            'Explore driven resonance, coupled oscillators, and normal modes as a bridge from oscillations to waves.',
          canonicalPath: '/oscillations/resonance',
          image: '/social/physics-nook-card.svg',
        },
      },
    ],
  },
  {
    slug: 'waves',
    href: '/waves',
    title: 'Waves',
    navLabel: 'Waves',
    summary:
      'Compare traveling waves, boundary reflections, standing waves, harmonics, and musical pitch.',
    audience: 'Self-learners building visual intuition for traveling waves.',
    prerequisites: ['Basic graph reading', 'Ratios', 'Periodic motion vocabulary'],
    learningObjectives: [
      'Differentiate transverse and longitudinal motion',
      'Relate amplitude, wavelength, period, and speed',
      'Track how the medium moves differently from the wave pattern',
      'Explain how superposition, reflection, and transmission satisfy boundary conditions',
      'Connect standing-wave boundary conditions to harmonics and musical pitch',
    ],
    status: 'active',
    navVisibility: 'menu',
    cardEyebrow: 'Core module',
    accent: '#2563eb',
    heroImage: '/social/physics-nook-card.svg',
    pages: [
      {
        id: 'waves-core',
        href: '/waves',
        title: 'Waves',
        description:
          'Build intuition for wave propagation by comparing what the pattern does with what the medium does.',
        seo: {
          title: 'Waves',
          description:
            'Explore wave propagation with interactive transverse and longitudinal wave comparisons.',
          canonicalPath: '/waves',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'waves-reflection-transmission',
        href: '/waves/reflection-transmission',
        title: 'Superposition and Reflection',
        shortTitle: 'Reflection',
        description:
          'See how incident, reflected, and transmitted waves combine at fixed, free, closed, and open boundaries.',
        seo: {
          title: 'Reflection, Transmission, and Superposition',
          description:
            'Learn wave superposition, reflection, transmission, and why open pipe ends still reflect sound with an interactive boundary explorer.',
          canonicalPath: '/waves/reflection-transmission',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'waves-standing-waves',
        href: '/waves/standing-waves',
        title: 'Standing Waves and Harmonics',
        shortTitle: 'Standing Waves',
        description:
          'Connect reflected waves, nodes, antinodes, harmonics, and musical pitch on strings and air columns.',
        seo: {
          title: 'Standing Waves and Harmonics',
          description:
            'Learn standing waves, harmonics, strings, air columns, and musical pitch with an interactive node-and-antinode explorer.',
          canonicalPath: '/waves/standing-waves',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'waves-sound-synthesis',
        href: '/waves/sound-synthesis',
        title: 'Sound Synthesis',
        shortTitle: 'Sound Synthesis',
        description:
          'Shape harmonic amplitudes, play a piano keyboard, and watch sound as a waveform or spectrogram.',
        seo: {
          title: 'Sound Synthesis',
          description:
            'Learn how additive synthesis builds musical timbre from harmonics with a playable piano keyboard, waveform display, and live spectrogram.',
          canonicalPath: '/waves/sound-synthesis',
          image: '/social/physics-nook-card.svg',
        },
      },
    ],
  },
  {
    slug: 'quantum',
    href: '/quantum',
    title: 'Quantum',
    navLabel: 'Quantum',
    summary:
      'Move from key experiments into wavefunctions, quantized states, and time evolution.',
    audience: 'Self-learners building a first modern-physics intuition before a formal quantum course.',
    prerequisites: [
      'Core wave vocabulary such as wavelength, frequency, and interference',
      'Basic energy relationships and algebra',
      'Comfort reading graphs and simple probability statements',
    ],
    learningObjectives: [
      'Use the photoelectric effect and double-slit interference to explain why classical pictures break down',
      'Interpret a wavefunction through amplitudes, probabilities, normalization, and measurement',
      'Connect boundary conditions and normalizable solutions to quantized energy levels in the infinite well, harmonic oscillator, and hydrogen atom',
      'Use the time-dependent Schrodinger equation to explain phase evolution, spreading, scattering, and interference',
    ],
    status: 'active',
    navVisibility: 'hidden',
    cardEyebrow: 'Next module',
    accent: '#0891b2',
    heroImage: '/social/physics-nook-card.svg',
    pages: [
      {
        id: 'quantum-foundations',
        href: '/quantum',
        title: 'Quantum Foundations',
        shortTitle: 'Foundations',
        description:
          'Use the photoelectric effect and single-particle interference to motivate quantum ideas.',
        seo: {
          title: 'Quantum Foundations',
          description:
            'Start the quantum path with the photoelectric effect, de Broglie wavelength, and inline labs for the photoelectric and double-slit experiments.',
          canonicalPath: '/quantum',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'quantum-wavefunctions',
        href: '/quantum/wavefunctions',
        title: 'Wavefunctions',
        shortTitle: 'Wavefunctions',
        description:
          'Interpret amplitudes, probabilities, and measurement in a one-dimensional quantum state.',
        seo: {
          title: 'Wavefunctions',
          description:
            'Learn how wavefunctions encode amplitudes, normalization, and position measurements.',
          canonicalPath: '/quantum/wavefunctions',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'quantum-quantization',
        href: '/quantum/quantization',
        title: 'Quantization',
        shortTitle: 'Quantization',
        description:
          'Use bound-state potentials to build intuition for discrete energies in quantum systems.',
        seo: {
          title: 'Quantization',
          description:
            'Explore the Schrodinger equation, the infinite well, the harmonic oscillator, and hydrogen radial states.',
          canonicalPath: '/quantum/quantization',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'quantum-time-evolution',
        href: '/quantum/time-evolution',
        title: 'Time Evolution',
        shortTitle: 'Time Evolution',
        description:
          'Evolve wavefunctions through free spreading, finite barriers, and two-dimensional interference.',
        seo: {
          title: 'Quantum Time Evolution',
          description:
            'Learn the time-dependent Schrodinger equation with wave-packet spreading, finite-barrier scattering, and a two-dimensional split-step simulator.',
          canonicalPath: '/quantum/time-evolution',
          image: '/social/physics-nook-card.svg',
        },
      },
    ],
  },
  {
    slug: 'thermodynamics',
    href: '/thermodynamics',
    title: 'Thermodynamics',
    navLabel: 'Thermodynamics',
    summary:
      'Systems, heat, work, entropy, and information viewed through energy bookkeeping and statistical reasoning.',
    audience: 'Self-learners building a first bridge from mechanics into thermal and statistical physics.',
    prerequisites: [
      'Basic energy conservation',
      'Comfort reading graphs and histograms',
      'Algebra with logarithms and proportional reasoning',
    ],
    learningObjectives: [
      'Describe systems, surroundings, equilibrium, state variables, temperature, and internal energy',
      'Use one consistent first-law sign convention with work done by the system',
      'Interpret entropy increase as a statistical tendency over microstates and macrostates',
      'Connect thermodynamic entropy with missing information, Shannon entropy, bits, and erasure cost',
    ],
    status: 'active',
    navVisibility: 'hidden',
    cardEyebrow: 'Thermodynamics',
    accent: '#ea580c',
    heroImage: '/social/physics-nook-card.svg',
    pages: [
      {
        id: 'thermodynamics-foundations',
        href: '/thermodynamics',
        title: 'Thermodynamics Foundations',
        shortTitle: 'Foundations',
        description:
          'Introduce systems, surroundings, state variables, equilibrium, temperature, and internal energy.',
        seo: {
          title: 'Thermodynamics Foundations',
          description:
            'Start the thermodynamics path with systems, state variables, thermal equilibrium, temperature, and internal energy.',
          canonicalPath: '/thermodynamics',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'thermodynamics-first-law',
        href: '/thermodynamics/first-law',
        title: 'Heat, Work, and the First Law',
        shortTitle: 'First Law',
        description:
          'Track heat and work as energy transfers using Delta U = Q - W, with work done by the system.',
        seo: {
          title: 'Heat, Work, and the First Law',
          description:
            'Learn the first law of thermodynamics with heat, work, sign conventions, and energy-ledger examples.',
          canonicalPath: '/thermodynamics/first-law',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'thermodynamics-entropy',
        href: '/thermodynamics/entropy',
        title: 'Entropy and the Second Law',
        shortTitle: 'Entropy',
        description:
          'Use macrostates, microstates, multiplicity, and Boltzmann entropy to understand the second law.',
        seo: {
          title: 'Entropy and the Second Law',
          description:
            'Explore entropy through multiplicity, Boltzmann entropy, spontaneous processes, and the second law.',
          canonicalPath: '/thermodynamics/entropy',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'thermodynamics-information-entropy',
        href: '/thermodynamics/information-entropy',
        title: 'Information and Entropy',
        shortTitle: 'Information',
        description:
          'Bridge physical entropy to Shannon entropy, bits, erasure, and Landauer cost.',
        seo: {
          title: 'Information and Entropy',
          description:
            'Connect thermodynamic entropy with missing information, Shannon entropy, bit erasure, and Landauer principle.',
          canonicalPath: '/thermodynamics/information-entropy',
          image: '/social/physics-nook-card.svg',
        },
      },
    ],
  },
  {
    slug: 'forces',
    href: '/forces',
    title: 'Forces',
    navLabel: 'Forces',
    summary:
      'Build force intuition with Newt the physics frog, from spring-like contacts to gravity and friction.',
    audience: 'Self-learners moving from kinematics into Newtonian dynamics.',
    prerequisites: ['Vectors in two dimensions', 'Acceleration', 'Basic algebra'],
    learningObjectives: [
      'Connect net force to acceleration',
      'Use spring-like microscopic models for normal force and tension',
      'Draw force vectors for gravity, friction, normal force, tension, and applied pushes',
    ],
    status: 'active',
    navVisibility: 'hidden',
    cardEyebrow: 'Mechanics',
    accent: '#16a34a',
    heroImage: '/social/physics-nook-card.svg',
    pages: [
      {
        id: 'forces-core',
        href: '/forces',
        title: 'Forces',
        description:
          'Explore common mechanics forces with Newt the physics frog, from spring-like contact forces to gravity and friction.',
        seo: {
          title: 'Forces',
          description:
            'Learn common mechanics forces with inline interactives featuring Newt the physics frog, including spring force, normal force, tension, gravity, and friction.',
          canonicalPath: '/forces',
          image: '/social/physics-nook-card.svg',
        },
      },
    ],
  },
  {
    slug: 'collisions',
    href: '/collisions',
    title: 'Collisions',
    navLabel: 'Collisions',
    summary:
      'Use one-dimensional collisions to compare momentum conservation with changing kinetic energy.',
    audience: 'Self-learners practicing momentum bookkeeping.',
    prerequisites: ['Vectors in one dimension', 'Momentum and kinetic energy basics', 'Algebra'],
    learningObjectives: [
      'Identify when momentum is conserved',
      'Distinguish elastic, inelastic, and perfectly inelastic collisions',
      'Use worked examples to solve one-dimensional collision problems',
    ],
    status: 'active',
    navVisibility: 'hidden',
    cardEyebrow: 'Core module',
    accent: '#dc2626',
    heroImage: '/social/physics-nook-card.svg',
    pages: [
      {
        id: 'collisions-core',
        href: '/collisions',
        title: 'Collisions',
        description:
          'Compare elastic and inelastic collisions while keeping momentum and energy bookkeeping straight.',
        seo: {
          title: 'Collisions',
          description:
            'Learn elastic and inelastic collisions through worked examples and a one-dimensional collision explorer.',
          canonicalPath: '/collisions',
          image: '/social/physics-nook-card.svg',
        },
      },
    ],
  },
  {
    slug: 'energy',
    href: '/energy',
    title: 'Energy',
    navLabel: 'Energy',
    summary:
      'Track kinetic, gravitational, and thermal energy with a cart moving along a curved track.',
    audience: 'Self-learners connecting work, potential energy, and conservation.',
    prerequisites: ['Force and motion basics', 'Algebra', 'Graphs and rates of change'],
    learningObjectives: [
      'Use the work-energy theorem to organize motion',
      'Reinterpret conservative work as changes in potential energy',
      'Track how friction shifts mechanical energy into thermal energy',
    ],
    status: 'active',
    navVisibility: 'hidden',
    cardEyebrow: 'Next module',
    accent: '#7c3aed',
    heroImage: '/social/physics-nook-card.svg',
    pages: [
      {
        id: 'energy-core',
        href: '/energy',
        title: 'Energy',
        description:
          'Use a curved track explorer to connect work, potential energy, mechanical energy, and friction.',
        seo: {
          title: 'Energy',
          description:
            'Explore the work-energy theorem and energy conservation with a curved-track energy explorer.',
          canonicalPath: '/energy',
          image: '/social/physics-nook-card.svg',
        },
      },
    ],
  },
  {
    slug: 'electromagnetism',
    href: '/electromagnetism',
    title: 'Electromagnetism',
    navLabel: 'Electromagnetism',
    summary:
      'Build the field concept from Coulomb’s law, connect it to potential energy, and follow charges into currents and circuits.',
    audience: 'Self-learners moving from mechanics into electricity and the field picture.',
    prerequisites: ['Vectors in two dimensions', 'Coulomb’s law and charge', 'Work and potential energy'],
    learningObjectives: [
      'Define the electric field as force per unit charge and build it from point charges',
      'Use superposition to combine fields and read field lines',
      'Connect electric potential energy, electric potential, and the field as its gradient',
      'Relate microscopic electron drift to Ohm’s law and circuit behavior',
    ],
    status: 'active',
    navVisibility: 'menu',
    cardEyebrow: 'Fields',
    accent: '#6366f1',
    heroImage: '/social/physics-nook-card.svg',
    pages: [
      {
        id: 'electromagnetism-field',
        href: '/electromagnetism',
        title: 'Electric Field',
        shortTitle: 'Electric Field',
        description:
          'Define the electric field as force per unit charge, build it from point charges, and explore superposition and field lines.',
        seo: {
          title: 'Electric Field',
          description:
            'Learn the electric field as force per unit charge, build it from point charges, and explore superposition and field lines with interactive simulations.',
          canonicalPath: '/electromagnetism',
          image: '/social/physics-nook-card.svg',
        },
      },
      {
        id: 'electromagnetism-potential',
        href: '/electromagnetism/potential',
        title: 'Electric Potential',
        shortTitle: 'Potential',
        description:
          'Move from force to energy: potential energy landscapes, the electric potential, and its relationship to the field.',
        seo: {
          title: 'Electric Potential',
          description:
            'Learn electric potential as potential energy per unit charge, visualize V(x,y) as a color map, and connect potential to the electric field.',
          canonicalPath: '/electromagnetism/potential',
          image: '/social/physics-nook-card.svg',
        },
      },
    ],
  },
];

export const featuredModule = modules.find((module) => module.featured) ?? modules[0];

export const secondaryModules = modules.filter((module) => module.slug !== featuredModule.slug);

const mustGetModuleBySlug = (slug: string) => {
  const module = modules.find((entry) => entry.slug === slug);

  if (!module) {
    throw new Error(`Unknown module slug: ${slug}`);
  }

  return module;
};

const relativityModule = mustGetModuleBySlug('relativity');
const mathModule = mustGetModuleBySlug('math');
const kinematicsModule = mustGetModuleBySlug('kinematics');
const forcesModule = mustGetModuleBySlug('forces');
const oscillationsModule = mustGetModuleBySlug('oscillations');
const wavesModule = mustGetModuleBySlug('waves');
const quantumModule = mustGetModuleBySlug('quantum');
const thermodynamicsModule = mustGetModuleBySlug('thermodynamics');
const collisionsModule = mustGetModuleBySlug('collisions');
const electromagnetismModule = mustGetModuleBySlug('electromagnetism');
const gameSiteUrl =
  import.meta.env.PUBLIC_GAME_URL ??
  (import.meta.env.DEV ? 'http://127.0.0.1:5173' : 'https://game.physicsnook.com');
const orbitalsGameHref = `${gameSiteUrl.replace(/\/$/, '')}/orbitals/`;

export const quantumModuleMeta = quantumModule;

export const mathPath = {
  id: 'math',
  href: mathModule.href,
  navLabel: mathModule.navLabel,
  summary: mathModule.summary,
  cardEyebrow: mathModule.cardEyebrow,
  navVisibility: 'menu',
  pages: mathModule.pages,
} satisfies ModulePathGroup;

export const mechanicsPath = {
  id: 'mechanics',
  href: kinematicsModule.href,
  navLabel: 'Mechanics',
  summary:
    'Core motion ideas from one-dimensional graphs to forces, vectors, and collisions.',
  cardEyebrow: 'Mechanics',
  navVisibility: 'menu',
  pages: [
    ...kinematicsModule.pages,
    forcesModule.pages[0],
    collisionsModule.pages[0],
  ],
} satisfies ModulePathGroup;

export const relativityPath = {
  id: 'relativity',
  href: relativityModule.href,
  navLabel: relativityModule.navLabel,
  summary: relativityModule.summary,
  cardEyebrow: relativityModule.cardEyebrow,
  navVisibility: 'menu',
  pages: relativityModule.pages,
} satisfies ModulePathGroup;

export const wavesAndOscillationsPath = {
  id: 'waves-and-oscillations',
  href: '/oscillations',
  navLabel: 'Waves & Oscillations',
  summary:
    'Periodic motion, springs, pendulums, and traveling waves collected under one quieter thread.',
  cardEyebrow: 'Waves & oscillations',
  navVisibility: 'menu',
  pages: [
    oscillationsModule.pages[0],
    oscillationsModule.pages[1],
    ...wavesModule.pages,
  ],
} satisfies ModulePathGroup;

export const electromagnetismPath = {
  id: 'electromagnetism',
  href: electromagnetismModule.href,
  navLabel: electromagnetismModule.navLabel,
  summary: electromagnetismModule.summary,
  cardEyebrow: electromagnetismModule.cardEyebrow,
  navVisibility: 'menu',
  pages: electromagnetismModule.pages,
} satisfies ModulePathGroup;

export const quantumPath = {
  id: 'quantum',
  href: quantumModule.href,
  navLabel: quantumModule.navLabel,
  summary: quantumModule.summary,
  cardEyebrow: quantumModule.cardEyebrow,
  navVisibility: 'menu',
  pages: quantumModule.pages,
} satisfies ModulePathGroup;

export const thermodynamicsPath = {
  id: 'thermodynamics',
  href: thermodynamicsModule.href,
  navLabel: thermodynamicsModule.navLabel,
  summary: thermodynamicsModule.summary,
  cardEyebrow: thermodynamicsModule.cardEyebrow,
  navVisibility: 'hidden',
  pages: thermodynamicsModule.pages,
} satisfies ModulePathGroup;

export const gamesPath = {
  id: 'orbitals-game',
  href: orbitalsGameHref,
  navLabel: 'Orbitals',
  summary:
    'Shared multiplayer physics sandboxes and experimental game pages.',
  cardEyebrow: 'Games',
  navVisibility: 'hidden',
  pages: [
    {
      id: 'orbitals',
      href: orbitalsGameHref,
      title: 'Orbitals',
      description:
        'A shared N-body gravity sandbox where everyone can add masses to one persistent canvas.',
      seo: {
        title: 'Orbitals',
        description:
          'A shared N-body gravity sandbox where everyone can add masses to one persistent canvas.',
        canonicalPath: '/orbitals',
        image: '/social/physics-nook-card.svg',
        noindex: true,
      },
    },
  ],
} satisfies ModulePathGroup;

export const exploreModuleGroups = [
  mathPath,
  mechanicsPath,
  relativityPath,
  wavesAndOscillationsPath,
  quantumPath,
  electromagnetismPath,
  thermodynamicsPath,
  gamesPath,
].filter((group) => group.navVisibility === 'menu');

export const publicPageMeta = [
  homePageMeta,
  ...standalonePages,
  ...modules.flatMap((module) => module.pages.map((page) => page.seo)),
];

export const getModuleBySlug = (slug: string) =>
  modules.find((module) => module.slug === slug);

export const getModuleByPath = (path: string) =>
  modules.find((module) => {
    const normalizedModulePath = normalizePath(module.href);
    const normalizedPath = normalizePath(path);
    return (
      normalizedPath === normalizedModulePath ||
      normalizedPath.startsWith(`${normalizedModulePath}/`)
    );
  });

export const getPageMetaByPath = (path: string) =>
  publicPageMeta.find((page) => normalizePath(page.canonicalPath) === normalizePath(path));
