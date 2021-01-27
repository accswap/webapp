import { createModule, action, mutation } from "vuex-class-component";
import {
  buildStakingRewardsContract,
  buildStakingRewardsStoreContract
} from "@/api/eth/contractTypes";
import { vxm } from "@/store";
import BigNumber from "bignumber.js";
import { OnUpdate, TxResponse } from "@/types/bancor";
import { multiSteps } from "@/api/helpers";
import wait from "waait";
import { shrinkToken } from "@/api/eth/helpers";
import { expandToken } from "@/api/pureHelpers";

const VuexModule = createModule({
  strict: false
});

export interface PoolProgram {
  poolToken: string;
  startTimes: string;
  endTimes: string;
  rewardRates: string;
  reserveTokens: string[];
  rewardShares: string[];
}

export class RewardsModule extends VuexModule.With({
  namespaced: "rewards/"
}) {
  totalClaimedRewards: BigNumber = new BigNumber(0);
  pendingRewards: BigNumber = new BigNumber(0);

  get balance() {
    const totalRewards = this.totalClaimedRewards.plus(this.pendingRewards);
    const bntPrice = vxm.bancor.stats.bntUsdPrice || 0;

    return {
      totalRewards: {
        bnt: totalRewards,
        usd: totalRewards.times(bntPrice)
      },
      totalClaimedRewards: {
        bnt: this.totalClaimedRewards,
        usd: this.totalClaimedRewards.times(bntPrice)
      },
      pendingRewards: {
        bnt: this.pendingRewards,
        usd: this.pendingRewards.times(bntPrice)
      }
    };
  }

  get contract() {
    return buildStakingRewardsContract(vxm.ethBancor.contracts.StakingRewards);
  }

  get currentUser() {
    return vxm.ethBancor.currentUser;
  }

  @action async stakeRewards({
    maxAmount,
    poolId,
    onUpdate
  }: {
    maxAmount: string;
    poolId: string;
    onUpdate: OnUpdate;
  }): Promise<TxResponse> {
    const txHash = (await multiSteps({
      items: [
        {
          description: "Restaking Rewards ...",
          task: async () => {
            return vxm.ethBancor.resolveTxOnConfirmation({
              tx: this.contract.methods.stakeRewards(
                expandToken(maxAmount, 18),
                poolId
              ),
              onConfirmation: async () => {
                await wait(3000);
                await this.loadData();
                vxm.ethBancor.fetchProtectionPositions({});
                vxm.ethBancor.fetchAndSetLockedBalances({});
                await wait(3000);
                await this.loadData();
                vxm.ethBancor.fetchProtectionPositions({});
                vxm.ethBancor.fetchAndSetLockedBalances({});
                console.log("tx confirmed");
              },
              resolveImmediately: true
            });
          }
        }
      ],
      onUpdate
    })) as string;

    return {
      blockExplorerLink: await vxm.ethBancor.createExplorerLink(txHash),
      txId: txHash
    };
  }

  @action async claimRewards({
    onUpdate
  }: {
    onUpdate: OnUpdate;
  }): Promise<TxResponse> {
    const txHash = (await multiSteps({
      items: [
        {
          description: "Withdrawing Rewards ...",
          task: async () => {
            return vxm.ethBancor.resolveTxOnConfirmation({
              tx: this.contract.methods.claimRewards(),
              onConfirmation: async () => {
                await wait(3000);
                console.log("tx confirmed");
                await this.loadData();
                vxm.ethBancor.fetchProtectionPositions({});
                vxm.ethBancor.fetchAndSetLockedBalances({});
                await wait(3000);
                await this.loadData();
                vxm.ethBancor.fetchProtectionPositions({});
                vxm.ethBancor.fetchAndSetLockedBalances({});
              },
              resolveImmediately: true
            });
          }
        }
      ],
      onUpdate
    })) as string;

    return {
      blockExplorerLink: await vxm.ethBancor.createExplorerLink(txHash),
      txId: txHash
    };
  }

  @action async loadData() {
    try {
      await this.fetchPoolPrograms();
      await this.fetchAndSetPendingRewards();
      await this.fetchAndSetTotalClaimedRewards();
    } catch (e) {
      console.error("Threw in load data on rewardsmodule");
      throw new Error(e);
    }
  }

  @action async fetchAndSetTotalClaimedRewards(): Promise<BigNumber> {
    const result = await this.contract.methods
      .totalClaimedRewards(this.currentUser)
      .call();

    const value = new BigNumber(shrinkToken(result, 18));
    this.setTotalClaimedRewards(value);
    return value;
  }

  @action async fetchAndSetPendingRewards(): Promise<BigNumber> {
    const result = await this.contract.methods
      .pendingRewards(this.currentUser)
      .call();

    const value = new BigNumber(shrinkToken(result, 18));
    this.setPendingRewards(value);

    return value;
  }

  poolPrograms?: PoolProgram[];

  @action async fetchPoolPrograms(
    rewardsStoreContract?: string
  ): Promise<PoolProgram[]> {
    if (this.poolPrograms) {
      return this.poolPrograms;
    }

    try {
      const storeContract =
        rewardsStoreContract || (await this.contract.methods.store().call());
      const store = buildStakingRewardsStoreContract(storeContract);
      const result = await store.methods.poolPrograms().call();

      const poolPrograms: PoolProgram[] = [];

      for (let i = 0; i < result[0].length; i++) {
        poolPrograms.push({
          poolToken: result[0][i],
          startTimes: result[1][i],
          endTimes: result[2][i],
          rewardRates: result[3][i],
          reserveTokens: result[4][i],
          rewardShares: result[5][i]
        });
      }
      this.setPoolPrograms(poolPrograms);

      console.log("Pool Programs", poolPrograms);

      return poolPrograms;
    } catch (e) {
      throw new Error(`Failed fetching pool programs ${e.message}`);
    }
  }

  @mutation setPoolPrograms(value: PoolProgram[]) {
    this.poolPrograms = value;
  }

  @mutation setTotalClaimedRewards(value: BigNumber) {
    this.totalClaimedRewards = value;
  }

  @mutation setPendingRewards(value: BigNumber) {
    this.pendingRewards = value;
  }

  @action async fetchPendingReserveRewards({
    poolId,
    reserveId
  }: {
    poolId: string;
    reserveId: string;
  }): Promise<BigNumber> {
    const result = await this.contract.methods
      .pendingReserveRewards(this.currentUser, poolId, reserveId)
      .call();

    return new BigNumber(shrinkToken(result, 18));
  }
}
