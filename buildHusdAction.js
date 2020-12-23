module.exports = ({ quantity, memo }) => ({
    account: "husd.hypha",
    name: "transfer",
    authorization: [{
        actor:"............1",
        permission: "............2"
    }
    ],
    data: {
        from:"............1",
        to: "tlosto.seeds",
        quantity: quantity,
        memo: memo || ""
    }
})