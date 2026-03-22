import { NextResponse } from 'next/server';

/* ═══════════════════════════════════════════════════════════════
   Industrial Intelligence API
   Flow meter data, equipment specs, TCO calculations,
   IoT device registry, regulatory standards, and diagnostics.
   ═══════════════════════════════════════════════════════════════ */

export interface FlowMeterTech {
  id: string;
  name: string;
  principle: string;
  accuracy: string;
  movingParts: boolean;
  pressureDrop: string;
  turndown: string;
  costTier: string;
  bestFor: string;
  limitations: string;
  diagnostics: string[];
  costRange4in: string;
}

const FLOW_METER_TECHNOLOGIES: FlowMeterTech[] = [
  {
    id: 'coriolis', name: 'Coriolis', principle: 'Vibrating tubes measure Coriolis effect twist proportional to mass flow. Direct mass measurement independent of fluid properties.',
    accuracy: '±0.1–0.5%', movingParts: false, pressureDrop: 'Moderate', turndown: '80:1+', costTier: 'High',
    bestFor: 'Custody transfer, pharmaceutical dosing, chemical blending',
    limitations: 'High cost, bulk for large pipe sizes',
    diagnostics: ['Tube coating/fouling detection', 'Entrained gas detection', 'Tube corrosion/erosion shifts', 'Gas void fraction estimation'],
    costRange4in: '$15,000–$40,000',
  },
  {
    id: 'electromagnetic', name: 'Electromagnetic (Mag)', principle: "Faraday's law: conductive fluid through magnetic field generates voltage proportional to flow velocity.",
    accuracy: '±0.2–0.5%', movingParts: false, pressureDrop: 'None', turndown: '100:1', costTier: 'Medium',
    bestFor: 'Water/wastewater, slurries, corrosive chemicals',
    limitations: 'Fluid must be electrically conductive — cannot measure hydrocarbons or gases',
    diagnostics: ['Empty pipe detection', 'Electrode coating (impedance)', 'Electrical noise rejection', 'Pulsed-DC electrochemical noise filtering'],
    costRange4in: '$3,000–$8,000',
  },
  {
    id: 'ultrasonic', name: 'Ultrasonic', principle: 'Transit-time: sound pulses upstream/downstream, time difference = velocity. Doppler: bounces off particles/bubbles.',
    accuracy: '±0.5–1%', movingParts: false, pressureDrop: 'None', turndown: '50:1', costTier: 'Med–High',
    bestFor: 'Large pipes, retrofit (clamp-on), clean fluids',
    limitations: 'Transit-time needs clean fluid; Doppler needs particles/bubbles; clamp-on accuracy varies',
    diagnostics: ['Signal quality per path', 'SNR & gain levels', 'Wax/scale/particulate detection', 'Degraded mode on path failure'],
    costRange4in: '$5,000–$15,000',
  },
  {
    id: 'vortex', name: 'Vortex Shedding', principle: 'Bluff body creates alternating vortices. Vortex frequency proportional to flow velocity (Strouhal number relationship).',
    accuracy: '±0.5–1%', movingParts: false, pressureDrop: 'Moderate', turndown: '20:1', costTier: 'Medium',
    bestFor: 'Steam measurement, high-temperature applications',
    limitations: 'Struggles at very low flow rates where vortices become too weak to detect',
    diagnostics: ['Vibration compensation', 'Signal amplitude analysis', 'Process noise separation'],
    costRange4in: '$4,000–$10,000',
  },
  {
    id: 'turbine', name: 'Turbine', principle: 'Fluid spins a rotor; rotation speed correlates to flow rate via pickup coil pulse counting.',
    accuracy: '±0.25–0.5%', movingParts: true, pressureDrop: 'Moderate', turndown: '10:1', costTier: 'Low–Med',
    bestFor: 'Clean liquids, custody transfer of refined products',
    limitations: 'Moving parts wear with dirty/abrasive fluids; bearing replacement needed',
    diagnostics: ['Bearing wear detection', 'Blade damage indicators', 'Spin-down time analysis'],
    costRange4in: '$3,000–$8,000',
  },
  {
    id: 'dp-orifice', name: 'Differential Pressure (DP)', principle: "Orifice plate/venturi creates pressure drop. ΔP relates to flow by Bernoulli's principle (square-root relationship).",
    accuracy: '±1–2%', movingParts: false, pressureDrop: 'High', turndown: '3–5:1', costTier: 'Low',
    bestFor: 'General process, legacy installations, wide fluid compatibility',
    limitations: 'Permanent pressure loss, edge erosion degrades accuracy, impulse line maintenance',
    diagnostics: ['Impulse line blockage detection', 'Leak detection', 'Freeze protection monitoring', 'Multivariable consistency checks'],
    costRange4in: '$2,000–$5,000',
  },
  {
    id: 'thermal-mass', name: 'Thermal Mass', principle: 'Measures how much heat fluid carries away from heated sensor. Direct mass flow reading for gases.',
    accuracy: '±1–2%', movingParts: false, pressureDrop: 'None', turndown: '100:1', costTier: 'Medium',
    bestFor: 'Gas metering: HVAC, semiconductor fab, flare gas',
    limitations: 'Primarily for gas; affected by gas composition changes',
    diagnostics: ['Sensor drift detection', 'Contamination warnings', 'Self-test routines'],
    costRange4in: '$4,000–$10,000',
  },
  {
    id: 'positive-displacement', name: 'Positive Displacement', principle: 'Traps fixed volumes via gears/lobes and counts cycles. Volumetric totalization.',
    accuracy: '±0.1–0.5%', movingParts: true, pressureDrop: 'High', turndown: '10:1', costTier: 'Low–Med',
    bestFor: 'Totalization, home water/gas meters, batch dosing',
    limitations: 'Pressure drop, mechanical wear, not for dirty fluids',
    diagnostics: ['Gear wear detection', 'Slip rate monitoring', 'Overspeed protection'],
    costRange4in: '$2,000–$6,000',
  },
];

const REGULATORY_STANDARDS = [
  { id: 'api-mpms', name: 'API MPMS', domain: 'Petroleum custody transfer', region: 'Global', description: 'Manual of Petroleum Measurement Standards — chapters cover every aspect of hydrocarbon measurement' },
  { id: 'oiml-r117', name: 'OIML R117', domain: 'Liquid meters (commercial)', region: 'International', description: 'Dynamic measuring systems for liquids in trade' },
  { id: 'oiml-r137', name: 'OIML R137', domain: 'Gas meters', region: 'International', description: 'Gas meters with standard accuracy requirements' },
  { id: 'aga-3', name: 'AGA Report 3', domain: 'DP meters (natural gas)', region: 'North America', description: 'Orifice metering of natural gas — concentric, square-edged orifice plates' },
  { id: 'aga-7', name: 'AGA Report 7', domain: 'Turbine meters (gas)', region: 'North America', description: 'Measurement of gas by turbine meters' },
  { id: 'aga-9', name: 'AGA Report 9', domain: 'Ultrasonic meters (gas)', region: 'North America', description: 'Measurement of gas by multipath ultrasonic meters' },
  { id: 'iec-61508', name: 'IEC 61508/61511', domain: 'Safety instrumented systems', region: 'Global', description: 'Functional safety — SIL ratings for meters in safety-critical applications' },
  { id: 'fda-211', name: 'FDA 21 CFR 210/211', domain: 'Pharmaceutical', region: 'US', description: 'cGMP requirements — calibrated, maintained, documented instruments with ALCOA+ data integrity' },
  { id: 'mid-2014', name: 'MID 2014/32/EU', domain: 'Commercial metering', region: 'EU', description: 'Measuring Instruments Directive for meters used in commercial transactions' },
  { id: '3a-sanitary', name: '3-A Sanitary Standards', domain: 'Food & beverage', region: 'US', description: 'Surface finish, drainability, and CIP compatibility for sanitary meters' },
  { id: 'cfr-75', name: '40 CFR Part 75', domain: 'Emissions (CEMS)', region: 'US', description: 'Stack flow monitoring with annual relative accuracy test audits' },
  { id: 'cfr-98', name: '40 CFR Part 98', domain: 'GHG reporting', region: 'US', description: 'Mandatory greenhouse gas reporting — flow measurement at thousands of facilities' },
  { id: 'norsok', name: 'NORSOK I-104/I-105', domain: 'Offshore O&G', region: 'Norway', description: 'Among the world\'s most stringent fiscal metering standards for North Sea production' },
  { id: 'iec-62443', name: 'IEC 62443', domain: 'Industrial cybersecurity', region: 'Global', description: 'Zones, conduits, security levels for industrial control system protection' },
];

const CALIBRATION_METHODS = [
  { name: 'Gravimetric', accuracy: '0.01–0.05%', type: 'Primary standard', description: 'Fluid into tank on precision scale. Time + weight = true mass flow. NIST/PTB primary reference.' },
  { name: 'Volumetric Prover', accuracy: '0.01–0.02%', type: 'Primary standard', description: 'Piston/ball through known volume while meter counts pulses. Gold standard in oil & gas custody transfer.' },
  { name: 'Master Meter', accuracy: '0.1–0.5%', type: 'Transfer standard', description: 'Pre-calibrated reference meter in series. Simpler but inherits master\'s uncertainty.' },
  { name: 'In-Situ Verification', accuracy: 'Variable', type: 'Field check', description: 'Verifies meter where it operates. Catches installation-specific effects missed in lab.' },
];

const IOT_PROTOCOLS = [
  { name: 'HART', speed: '1.2 kbit/s', type: 'Analog+Digital', description: 'Superimposes digital on 4–20 mA. Carries diagnostics while maintaining backward compatibility.' },
  { name: 'Foundation Fieldbus', speed: '31.25 kbit/s', type: 'Digital bus', description: 'All-digital shared bus. Multiple variables + peer-to-peer communication.' },
  { name: 'PROFIBUS', speed: '12 Mbit/s', type: 'Digital bus', description: 'Process automation standard, especially in European plants.' },
  { name: 'Modbus RTU/TCP', speed: '19.2 kbit/s / 10 Mbit/s', type: 'Open protocol', description: 'Simple, ubiquitous. Building automation, water systems, smaller industrial.' },
  { name: 'OPC-UA', speed: 'Variable', type: 'Universal translator', description: 'Industry 4.0 standard — secure, platform-independent, field-to-cloud.' },
  { name: 'MQTT', speed: 'Variable', type: 'IoT messaging', description: 'Lightweight pub/sub. Edge gateways aggregate meter data for cloud analytics.' },
  { name: 'Ethernet-APL', speed: '10 Mbit/s', type: 'Field Ethernet', description: 'Two-wire, intrinsically safe, full TCP/IP. Early adopters: BASF, Shell, ExxonMobil.' },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const section = searchParams.get('section') || 'all';

  const data: Record<string, unknown> = { status: 'ok', timestamp: Date.now() };

  if (section === 'all' || section === 'technologies') data.technologies = FLOW_METER_TECHNOLOGIES;
  if (section === 'all' || section === 'regulations') data.regulations = REGULATORY_STANDARDS;
  if (section === 'all' || section === 'calibration') data.calibration = CALIBRATION_METHODS;
  if (section === 'all' || section === 'protocols') data.protocols = IOT_PROTOCOLS;

  if (section === 'all' || section === 'tco') {
    data.tcoInputs = {
      description: 'Total Cost of Ownership calculator inputs',
      fields: ['purchasePrice', 'installationCost', 'annualMaintenance', 'annualCalibration', 'energyLossPerYear', 'measurementErrorCostPerYear', 'lifeYears'],
    };
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body.action === 'tco') {
      const { purchasePrice = 0, installationCost = 0, annualMaintenance = 0, annualCalibration = 0, energyLossPerYear = 0, measurementErrorCostPerYear = 0, lifeYears = 10 } = body;
      const totalMaintenance = (annualMaintenance + annualCalibration) * lifeYears;
      const totalEnergy = energyLossPerYear * lifeYears;
      const totalErrorCost = measurementErrorCostPerYear * lifeYears;
      const tco = purchasePrice + installationCost + totalMaintenance + totalEnergy + totalErrorCost;
      const annualized = tco / lifeYears;

      return NextResponse.json({
        status: 'ok',
        tco: {
          purchasePrice, installationCost, totalMaintenance, totalEnergy, totalErrorCost,
          totalCostOfOwnership: tco, annualizedCost: annualized, lifeYears,
          breakdown: [
            { category: 'Purchase', amount: purchasePrice, pct: (purchasePrice / tco * 100).toFixed(1) },
            { category: 'Installation', amount: installationCost, pct: (installationCost / tco * 100).toFixed(1) },
            { category: 'Maintenance', amount: totalMaintenance, pct: (totalMaintenance / tco * 100).toFixed(1) },
            { category: 'Energy Loss', amount: totalEnergy, pct: (totalEnergy / tco * 100).toFixed(1) },
            { category: 'Measurement Error', amount: totalErrorCost, pct: (totalErrorCost / tco * 100).toFixed(1) },
          ],
        },
      });
    }

    if (body.action === 'recommend') {
      const { fluidType, pipeSize, accuracy, budget, application } = body;
      const scored = FLOW_METER_TECHNOLOGIES.map(tech => {
        let score = 50;
        if (fluidType === 'water' && tech.id === 'electromagnetic') score += 30;
        if (fluidType === 'gas' && tech.id === 'thermal-mass') score += 25;
        if (fluidType === 'gas' && tech.id === 'vortex') score += 20;
        if (fluidType === 'steam' && tech.id === 'vortex') score += 35;
        if (fluidType === 'oil' && tech.id === 'coriolis') score += 30;
        if (fluidType === 'oil' && tech.id === 'turbine') score += 20;
        if (fluidType === 'slurry' && tech.id === 'electromagnetic') score += 35;
        if (fluidType === 'chemical' && tech.id === 'coriolis') score += 25;
        if (accuracy === 'high' && (tech.id === 'coriolis' || tech.id === 'positive-displacement')) score += 20;
        if (accuracy === 'moderate' && tech.id !== 'dp-orifice') score += 10;
        if (budget === 'low' && tech.costTier === 'Low') score += 20;
        if (budget === 'low' && tech.costTier === 'Low–Med') score += 15;
        if (budget === 'high' && tech.costTier === 'High') score += 10;
        if (!tech.movingParts) score += 10;
        if (tech.pressureDrop === 'None') score += 10;
        if (pipeSize === 'large' && tech.id === 'ultrasonic') score += 25;
        if (application === 'custody-transfer' && tech.id === 'coriolis') score += 25;
        if (application === 'process-control' && tech.pressureDrop === 'None') score += 15;
        return { ...tech, score: Math.min(score, 100) };
      });
      scored.sort((a, b) => b.score - a.score);
      return NextResponse.json({ status: 'ok', recommendations: scored.slice(0, 4) });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
