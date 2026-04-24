import pandas as pd

start_price = 5234
end_price = 5014

gridA = 4
gridB = 10
lot_size = 0.01

contract_size = 100
value_per_point = lot_size * contract_size

orders = []

# initial order
orders.append(start_price)

price = start_price

while price - gridB >= end_price:

    gridB_price = price - gridB
    gridA_price = gridB_price + gridA

    orders.append(gridB_price)
    orders.append(gridA_price)

    price = gridB_price

current_price = end_price

data = []
total_pnl = 0

for entry in orders:

    pnl = (current_price - entry) * value_per_point
    total_pnl += pnl

    data.append({
        "Entry Price": entry,
        "Current Price": current_price,
        "Floating PnL": pnl
    })

df = pd.DataFrame(data)

print("Total Orders:", len(orders))
print("Floating PnL:", total_pnl)

df.to_excel("grid_mtm_calculation_10_4_400points.xlsx", index=False)