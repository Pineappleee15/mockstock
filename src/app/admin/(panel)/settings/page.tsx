import { activeCompetition } from "@/lib/queries";
import { Empty } from "@/components/ui";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const comp = await activeCompetition();
  if (!comp) return <Empty>No competition. Run the seed script to create one.</Empty>;
  return <SettingsForm competition={{
    id: comp.id, name: comp.name, mode: comp.mode, state: comp.state,
    startingCashPaise: comp.startingCashPaise, brokerageBps: comp.brokerageBps,
    spreadBps: comp.spreadBps, concentrationCapBps: comp.concentrationCapBps,
    orderRateLimitPerMin: comp.orderRateLimitPerMin, circuitLimitBps: comp.circuitLimitBps,
    sessionMinutes: comp.sessionMinutes,
    tickIntervalSeconds: comp.tickIntervalSeconds,
    volatilityMultiplierBps: comp.volatilityMultiplierBps,
    orderFlowEnabled: comp.orderFlowEnabled, impactCoefficientBps: comp.impactCoefficientBps,
    maxImpactBpsPerTick: comp.maxImpactBpsPerTick, gapHalflifeSeconds: comp.gapHalflifeSeconds,
    permanentImpactBps: comp.permanentImpactBps,
    regimeEnabled: comp.regimeEnabled, marketFactorBps: comp.marketFactorBps,
    liquidityMultiplierBps: comp.liquidityMultiplierBps, shockChanceBps: comp.shockChanceBps,
    autoNewsEnabled: comp.autoNewsEnabled,
  }} />;
}
