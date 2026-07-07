# Card Stats Endpoint 
## Returned Data
{
    "spend-amounts": {
        "total": 0,
        "max-per-transaction": 0,
        "days": {
            "2024-06-01": 0,
            "2024-06-02": 0,
            "2024-06-03": 0,
            ...
        },
        "weeks:" {
            "2024-06-01": 0,
            "2024-06-08": 0,
            "2024-06-15": 0,
            ...
        },
        "months": {
            "2024-01": 0,
            "2024-02": 0,
            "2024-03": 0,
            ...
        },
        "years": {
            "2024": 0,
            "2025": 0,
            ...
        },
        "semesters": {
            "sose24": 0,
            "wise24-25": 0,
            "sose25": 0,
            ...
        },
        "weekdays": {
            "monday": 0,
            "tuesday": 0,
            ...
        },
        "time": {
            "00:00-00:15": 0,
            "00:15-00:30": 0,
            ...
        },  
        "time-by-weekday": {
            "monday": {
                "00:00-00:15": 0,
                "00:15-00:30": 0,
                ...
            },
            "tuesday": {
                "00:00-00:15": 0,
                "00:15-00:30": 0,
                ...
            },
            ...
        },
        "categories": {
            "category1": 0,
            "category2": 0,
            ...
        },
        "canteens": {
            "canteen1id": 0,
            "canteen2id": 0,
            ...
        },
    },
    "spend-amount-averages": {
        "total": 0,
        ... // Same structure as spend-total but with average values without the max-per-transaction
    },
    "spend-counts": {
        "total": 0,
        ... // Same structure as spend-total but with spend counts without the max-per-transaction
    },
    "transaction-amounts": {
        "total": 0,
        ... // Same structure as spend-total but with transaction amounts
    },
    "transaction-amount-averages": {
        "total": 0,
        ... // Same structure as spend-total but with transaction averages without the max-per-transaction
    },
    "transaction-counts": {
        "total": 0,
        ... // Same structure as spend-total but with transaction counts without the max-per-transaction
    },
    "visits-counts": {
        "total": 0,
        ... // Same structure as spend-total but with visit counts without the max-per-transaction
    }, 
    "visits-averages": {
        "total": 0,
        ... // Same structure as spend-total but with visit averages without the max-per-transaction
    },
    "visit-streaks": {
        "longest": 0,
        "longest-without-weekends": 0,
        "longest-without-closed": 0,
        "current": 0,
        "current-without-weekends": 0,
        "current-without-closed": 0,
        "per-canteen": {
            "canteen1id": {
                "longest": 0,
                "longest-without-weekends": 0,
                "longest-without-closed": 0,
                "current": 0,
                "current-without-weekends": 0,
                "current-without-closed": 0
            },
            ...
        }
    },
    "top-up-amounts": {
        "total": 0,
        ... // Same structure as spend-total but with top-up amounts
    }, 
    "top-up-amount-averages": {
        "total": 0,
        ... // Same structure as spend-total but with top-up averages without the max-per-transaction
    },
    "top-up-counts": {
        "total": 0,
        ... // Same structure as spend-total but with top-up counts without the max-per-transaction
    },
    "food-types-amounts": {
        "drinks": {
            "total": 0,
            ... // Same structure as spend-total but with drink counts
        },
        "meals": {
            "total": 0,
            ... // Same structure as spend-total but with meal counts
        },
        "desserts": {
            "total": 0,
            ... // Same structure as spend-total but with dessert counts
        },
        "snacks": {
            "total": 0,
            ... // Same structure as spend-total but with snack counts
        },
        "other": {
            "total": 0,
            ... // Same structure as spend-total but with other counts
        }
    },
    "food-types-amount-averages": {
        "drinks": {
            "total": 0,
            ... // Same structure as spend-total but with drink counts without the max-per-transaction
        },
        "meals": {
            "total": 0,
            ... // Same structure as spend-total but with meal counts without the max-per-transaction
        },
        "desserts": {
            "total": 0,
            ... // Same structure as spend-total but with dessert counts without the max-per-transaction
        },
        "snacks": {
            "total": 0,
            ... // Same structure as spend-total but with snack counts without the max-per-transaction
        },
        "other": {
            "total": 0,
            ... // Same structure as spend-total but with other counts without the max-per-transaction
        }
    },
    "food-types-counts": {
        "drinks": {
            "total": 0,
            ... // Same structure as spend-total but with drink counts
        },
        "meals": {
            "total": 0,
            ... // Same structure as spend-total but with meal counts
        },
        "desserts": {
            "total": 0,
            ... // Same structure as spend-total but with dessert counts
        },
        "snacks": {
            "total": 0,
            ... // Same structure as spend-total but with snack counts
        },
        "other": {
            "total": 0,
            ... // Same structure as spend-total but with other counts
        }
    }
}