import numpy as np
from numba import jit
import time

@jit(nopython=True, fastmath=True)
def test_complex(power):
    z = 0.5 + 0.5j
    c = 0.1 + 0.2j
    for i in range(1000000):
        if power == 2:
            z = z*z + c
        else:
            z = z**power + c
    return z

start = time.time()
test_complex(2)
print("Compile + Run 1:", time.time() - start)

start = time.time()
test_complex(3)
print("Run 2:", time.time() - start)
