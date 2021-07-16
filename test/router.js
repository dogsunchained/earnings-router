const { accounts, contract } = require('@openzeppelin/test-environment');
const { BN, time, expectEvent, expectRevert, balance, send } = require('@openzeppelin/test-helpers');
const { ZERO_ADDRESS } = require('@openzeppelin/test-helpers/src/constants');
const { expect } = require('chai');

function e(x) {
    return new BN('10').pow(new BN('' + x))
}

const Router = contract.fromArtifact('EarningsRouter');
const DummyERC20 = contract.fromArtifact('DummyERC20')

describe('Router', () => {
    const [org, alice, bob, charity, david] = accounts
    describe('init', () => {
        beforeEach(async () => {
            this.router = await Router.new([org, alice, bob], [3, 2, 1], 365 * 24 * 60 * 60, {from:org})
        })

        it('should have each address stored in order', async () => {
            expect(await this.router.recipients(0)).to.be.equal(org)
            expect(await this.router.recipients(1)).to.be.equal(alice)
            expect(await this.router.recipients(2)).to.be.equal(bob)
        })

        it('should store the correct ownerships', async () => {
            expect(await this.router.ownerships(0)).to.be.bignumber.equal(new BN(3))
            expect(await this.router.ownerships(1)).to.be.bignumber.equal(new BN(2))
            expect(await this.router.ownerships(2)).to.be.bignumber.equal(new BN(1))
        })

        it('should sum the total ownership correctly', async () => {
            expect(await this.router.totalOwnership()).to.be.bignumber.equal(new BN(6))
        })

        it('should set the immutability lock to 1 year from now', async () => {
            const now = Math.round(Date.now() / 1000)
            expect(await this.router.immutableExpiration()).to.be.bignumber.closeTo(new BN(now + 365 * 24 * 60 * 60), new BN(30))
        })

        it('should not allow a change of recipients before lock expires', async () => {
            expectRevert(
                this.router.setDestinations([org, alice, bob], [3, 2, 1], 365 * 24 * 60 * 60, {from:org}),
                "Cannot change destinations yet"
            )
        })

        describe('after timelock expires', () => {
            beforeEach(async () => {
                this.oldExpiration = await this.router.immutableExpiration()
                await time.increaseTo(this.oldExpiration.add(new BN(1000)))
            })

            it('non-owner should not be able to update recipients', async () => {
                expectRevert(
                    this.router.setDestinations([org, alice, bob], [3, 2, 1], 365 * 24 * 60 * 60, {from:david}),
                    "Ownable: caller is not the owner."
                )
            })

            describe('owner should be able to update recipients', () => {
                beforeEach(async () => {
                    this.res = await this.router.setDestinations([org, alice], [5, 4], 1000, {from:org})
                })

                it('should have each address stored in order', async () => {
                    expect(await this.router.recipients(0)).to.be.equal(org)
                    expect(await this.router.recipients(1)).to.be.equal(alice)
                })
        
                it('should store the correct ownerships', async () => {
                    expect(await this.router.ownerships(0)).to.be.bignumber.equal(new BN(5))
                    expect(await this.router.ownerships(1)).to.be.bignumber.equal(new BN(4))
                })
        
                it('should sum the total ownership correctly', async () => {
                    expect(await this.router.totalOwnership()).to.be.bignumber.equal(new BN(9))
                })
        
                it('should set the immutability lock to 1 year from now', async () => {
                    const now = Math.round(Date.now() / 1000)
                    expect(await this.router.immutableExpiration()).to.be.bignumber.closeTo(this.oldExpiration.add(new BN(2000)), new BN(30))
                })
                
            })
        })
    })

    describe('ETH', () => {
        beforeEach(async () => {
            this.router = await Router.new([org, alice, bob, charity], [3, 2, 1, 1], 365 * 24 * 60 * 60, {from:org})
        })

        it('should update balance correctly when receiving ETH', async () => {
            const davidTracker = await balance.tracker(david, 'ether')
            const routerTracker = await balance.tracker(this.router.address, 'ether')
            send.ether(david, this.router.address, e(18))
            expect(await davidTracker.delta()).to.be.bignumber.equal('-1');
            expect(await routerTracker.delta()).to.be.bignumber.equal('1');
        })

        describe('distributing', () => {
            beforeEach(async () => {
                this.orgTracker = await balance.tracker(org, 'wei')
                this.aliceTracker = await balance.tracker(alice, 'wei')
                this.bobTracker = await balance.tracker(bob, 'wei')
                this.charityTracker = await balance.tracker(charity, 'wei')
                send.ether(david, this.router.address, e(18))
                this.res = await this.router.distribute(ZERO_ADDRESS)
            })

            it('should emit a distribution event', async () => {
                expectEvent(
                    this.res,
                    'EarningsDistributed',
                    { token: ZERO_ADDRESS, amount: e(18) }
                )
            })

            it('should send correct amounts to each recipient', async () => {
                expect(await this.orgTracker.delta()).to.be.bignumber.equal(e(18).mul(new BN(3)).div(new BN(7)))
                expect(await this.aliceTracker.delta()).to.be.bignumber.equal(e(18).mul(new BN(2)).div(new BN(7)))
                expect(await this.bobTracker.delta()).to.be.bignumber.equal(e(18).mul(new BN(1)).div(new BN(7)))
                expect(await this.charityTracker.delta()).to.be.bignumber.equal(e(18).mul(new BN(1)).div(new BN(7)))
            })

            it('should release all ETH from router', async () => {
                expect(await balance.current(this.router.address)).to.be.bignumber.closeTo(new BN(0), new BN(100))
            })
        })
    })

    describe('ERC20', () => {
        beforeEach(async () => {
            this.token = await DummyERC20.new(e(18 + 6), {from:david})
            this.router = await Router.new([org, alice, bob, charity], [3, 2, 1, 1], 365 * 24 * 60 * 60, {from:org})
        })

        it('should update balance correctly when receiving tokens', async () => {
            await this.token.transfer(this.router.address, e(18 + 5), {from:david})
            expect(await this.token.balanceOf(this.router.address)).to.be.bignumber.equal(e(18 + 5))
            expect(await this.token.balanceOf(david)).to.be.bignumber.equal(e(18 + 6).sub(e(18 + 5)))
        })

        describe('distributing', () => {
            beforeEach(async () => {
                this.transfer = this.token.transfer(this.router.address, e(18 + 5), {from:david}) //dust
                this.res = await this.router.distribute(this.token.address)
            })

            it('should emit a distribution event', async () => {
                expectEvent(
                    this.res,
                    'EarningsDistributed',
                    { token: this.token.address, amount: e(18 + 5) }
                )
            })

            it('should send correct amounts to each recipient', async () => {
                expect(await this.token.balanceOf(org)).to.be.bignumber.equal(e(18 + 5).mul(new BN(3)).div(new BN(7)))
                expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(e(18 + 5).mul(new BN(2)).div(new BN(7)))
                expect(await this.token.balanceOf(bob)).to.be.bignumber.equal(e(18 + 5).mul(new BN(1)).div(new BN(7)))
                expect(await this.token.balanceOf(charity)).to.be.bignumber.equal(e(18 + 5).mul(new BN(1)).div(new BN(7)))
            })

            it('should release all ERC20 from router', async () => {
                expect(await this.token.balanceOf(this.router.address)).to.be.bignumber.closeTo(new BN(0), new BN(100)) //dust
            })
        })
    })
})
